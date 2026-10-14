import re
import time

import requests
from playwright.sync_api import Page, Route, WebSocket, WebSocketRoute, expect

from agenttrace import AgentTraceClient


def test_local_mode_dashboard_and_live_event(page: Page, local_server):
    base, db_url = local_server
    page.goto(base)
    # no login screen in local mode; demo projects listed (project cards
    # carry the exact name; recent-activity rows embed it in longer text)
    expect(page.get_by_text("Customer Support Agent", exact=True).first).to_be_visible(timeout=15_000)
    expect(page.get_by_text("Research Assistant", exact=True).first).to_be_visible()
    expect(page.get_by_text("Code Review Bot", exact=True).first).to_be_visible()

    client = AgentTraceClient(db_url)
    run_id = client.create_run("e2e live run", project="Customer Support Agent")
    client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call", label="first step")

    # dashboard project card → project detail → run row
    page.get_by_text("Customer Support Agent", exact=True).first.click()
    expect(page.get_by_role("heading", name="Customer Support Agent")).to_be_visible(timeout=10_000)
    # record the frames of the run view's live socket from the moment it opens
    frames: list[str] = []

    def on_websocket(ws: WebSocket) -> None:
        if ws.url.endswith("/ws"):
            ws.on("framereceived", lambda payload: frames.append(str(payload)))

    page.on("websocket", on_websocket)
    page.get_by_text("e2e live run", exact=True).first.click()
    expect(page.get_by_text("first step").first).to_be_visible(timeout=10_000)
    _wait_for(page, lambda: any('"subscribed"' in f for f in frames), "live subscription")

    # From here on the REST run endpoint is unreachable (the 5 s refetch and
    # any gap-fill fail), so the next event can only arrive over /ws.
    def block_get(route: Route) -> None:
        if route.request.method == "GET":
            route.abort()
        else:
            route.fallback()

    page.route("**/api/runs/**", block_get)
    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="live arrow")
    expect(page.get_by_text("live arrow").first).to_be_visible(timeout=3_000)


def test_polling_fallback_when_websocket_is_blocked(page: Page, local_server):
    base, db_url = local_server
    client = AgentTraceClient(db_url)
    run_id = client.create_run("e2e polled run", project="Customer Support Agent")
    client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call", label="polled first")

    # Every /ws connection is swallowed (never connected to the server, its
    # messages dropped), registered before navigation so no live frame can
    # reach the page, as behind a proxy that doesn't forward WebSockets.
    # (Calling ws.close() from a sync-API handler deadlocks Playwright.)
    blocked: list[str] = []

    def drop(ws: WebSocketRoute) -> None:
        blocked.append(ws.url)
        ws.on_message(lambda message: None)

    page.route_web_socket(re.compile(r"/ws$"), drop)
    page.goto(base)
    page.get_by_text("Customer Support Agent", exact=True).first.click()
    expect(page.get_by_role("heading", name="Customer Support Agent")).to_be_visible(timeout=15_000)
    page.get_by_text("e2e polled run", exact=True).first.click()
    expect(page.get_by_text("polled first").first).to_be_visible(timeout=10_000)
    _wait_for(page, lambda: bool(blocked), "an intercepted /ws connection")

    # a new event reaches the diagram via the 5 s refetch alone. Up to two
    # cycles: a refetch already in flight when the event is written can come
    # back without it.
    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="polled second")
    expect(page.get_by_text("polled second").first).to_be_visible(timeout=12_000)

    # the run header counts the diagram's events
    expect(page.locator("header p")).to_have_text(re.compile(r"^2 events · "), timeout=8_000)

    # ending the run flips the diagram out of live mode: the header says so and
    # the filter row's live-stream indicator goes away
    client.end_run(run_id, status="completed")
    expect(page.locator("header").get_by_text("Completed", exact=True)).to_be_visible(timeout=12_000)
    expect(page.get_by_text(re.compile(r"^(Listening|Connecting…|Reconnecting…)$"))).to_have_count(0)


def test_project_runs_sort_by_keyboard_and_no_start_button(page: Page, local_server):
    base, _ = local_server
    page.goto(base)
    page.get_by_text("Customer Support Agent", exact=True).first.click()
    expect(page.get_by_role("heading", name="Customer Support Agent")).to_be_visible(timeout=15_000)
    # runs come from the agent: the page offers no way to start one
    expect(page.get_by_role("button", name=re.compile("start a run", re.I))).to_have_count(0)

    page.get_by_role("button", name="All runs").click()
    first_row = page.locator("#all-runs-panel li").first
    expect(first_row).to_contain_text("#7788")  # the demo's newest run
    # "Sort by" is the trigger's label: a click on it focuses the trigger, the list stays closed
    sort = page.get_by_role("combobox", name="Sort by")
    expect(sort).to_have_text("Date")
    page.locator("label[for='all-runs-sort']").click()
    expect(sort).to_be_focused()
    expect(page.get_by_role("listbox")).to_have_count(0)
    # open the sort list from the keyboard, type-ahead to Events, pick it
    page.keyboard.press("Enter")
    events = page.get_by_role("option", name="Events")
    expect(events).to_be_visible()
    page.keyboard.press("e")
    expect(events).to_have_attribute("data-highlighted", "")
    page.keyboard.press("Enter")
    expect(sort).to_have_text("Events")
    expect(first_row).to_contain_text("#5102")  # 10 events, the most
    # the closing list hands focus back to its trigger (a moment later)...
    expect(sort).to_be_focused()
    # ...and the direction button follows; it says the order and reverses it
    page.keyboard.press("Tab")
    expect(page.get_by_role("button", name="Most first")).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_role("button", name="Fewest first")).to_be_focused()
    expect(first_row).to_contain_text("#7788")  # 6 events, the fewest
    expect(page.locator("#all-runs-panel [role=status]")).to_have_text("Sorted by events, fewest first")


# Sideways overflow of <main> (the page's scroll container), which toolbar
# controls stick out of it, and how many lines the "Sort by" label takes.
TOOLBAR_LAYOUT = """() => {
  const main = document.querySelector('main')
  const left = main.getBoundingClientRect().left
  const panel = document.getElementById('all-runs-panel')
  const label = document.getElementById('all-runs-sort-label')
  const parts = {
    filter: panel.querySelector('input'),
    label,
    sort: panel.querySelector('[data-slot=select-trigger]'),
    direction: panel.querySelector("button[title='Reverse the order']"),
  }
  const clipped = Object.keys(parts).filter((k) => {
    const r = parts[k].getBoundingClientRect()
    return r.left < left - 0.5 || r.right > left + main.clientWidth + 0.5
  })
  const lines = Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight))
  return { overflow: main.scrollWidth - main.clientWidth, clipped, lines }
}"""


def test_project_toolbar_reflows_on_a_phone(page: Page, local_server):
    """WCAG 1.4.10: from 320 px wide, with the longest order label, the project
    page doesn't scroll sideways and the sort controls stay whole."""
    base, _ = local_server
    page.set_viewport_size({"width": 320, "height": 800})
    page.goto(base)
    page.get_by_role("button", name="Customer Support Agent", exact=True).first.click(timeout=15_000)
    expect(page.get_by_role("heading", name="Customer Support Agent")).to_be_visible(timeout=10_000)
    page.get_by_role("button", name="All runs").click()
    page.get_by_role("combobox", name="Sort by").click()
    page.get_by_role("option", name="Status").click()
    page.get_by_role("button", name="Running first").click()
    expect(page.get_by_role("button", name="Completed first")).to_be_visible()
    for width in (320, 360, 390):
        page.set_viewport_size({"width": width, "height": 800})
        layout = page.evaluate(TOOLBAR_LAYOUT)
        assert layout == {"overflow": 0, "clipped": [], "lines": 1}, (width, layout)


def test_empty_project_points_to_integration(page: Page, local_server):
    base, _ = local_server
    requests.post(f"{base}/api/projects", json={"name": "Empty project"}, timeout=5).raise_for_status()
    page.goto(base)
    page.get_by_text("Empty project", exact=True).first.click(timeout=15_000)
    expect(page.get_by_role("heading", name="Empty project")).to_be_visible(timeout=10_000)
    feed = page.locator("section[aria-labelledby='run-feed-title']")
    expect(feed).to_contain_text("No runs yet. Send events from your agent — see Integration.")
    expect(page.get_by_role("button", name=re.compile("start a run", re.I))).to_have_count(0)
    feed.get_by_role("button", name="Integration").click()
    expect(page.get_by_role("heading", name="Integration")).to_be_visible(timeout=10_000)
    expect(page.get_by_role("combobox", name="Project")).to_have_text("Empty project")


def test_password_mode_signup_and_sign_out(page: Page, password_server):
    base, _ = password_server
    page.goto(base)
    # auth screen → switch to sign-up, fill, submit
    page.get_by_role("tab", name="Create account").click()
    page.get_by_label("Name", exact=True).fill("E2E User")
    page.get_by_label("Email", exact=True).fill("e2e@example.com")
    page.get_by_label("Password", exact=True).fill("secret123")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_text("E2E User").first).to_be_visible(timeout=10_000)
    # sidebar sign-out (icon button, accessible name from its title)
    page.get_by_role("button", name="Sign out").first.click()
    expect(page.get_by_role("tab", name="Create account")).to_be_visible(timeout=10_000)


def _wait_for(page: Page, predicate, what: str, timeout: float = 10.0) -> None:
    # page.wait_for_timeout (not time.sleep) so Playwright keeps dispatching
    # events (websocket frames) to our handlers while we wait.
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        page.wait_for_timeout(50)
