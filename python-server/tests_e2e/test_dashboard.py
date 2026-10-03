import re
import time

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

    # a new event reaches the diagram via the 5 s refetch alone
    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="polled second")
    expect(page.get_by_text("polled second").first).to_be_visible(timeout=8_000)

    # ending the run flips the diagram out of live mode
    client.end_run(run_id, status="completed")
    expect(page.get_by_text(re.compile(r"^\d+ events · completed$"))).to_be_visible(timeout=8_000)
    expect(page.get_by_text(re.compile(r"^(listening|connecting…)$"))).to_have_count(0)


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
