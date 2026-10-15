"""Themes, motion and empty states, end to end; ends by saving a screenshot of
each theme (the CI `theme-screenshots` artifact)."""

import re
import time

import pytest
from playwright.sync_api import Page, expect

from lanetrace import LaneTraceClient
from conftest import (
    THEME_LABELS,
    THEME_REVEAL_MS,
    THEMES,
    arrow,
    open_run,
    screenshot_dir,
    theme_init_script,
    wait_for,
    watch_console,
)

VIEWPORT = {"width": 1440, "height": 900}

# Every value <html data-theme> takes from first paint on. The boot script sets
# it in <head>; once <body> exists the page can paint, so the value at that
# moment is noted, as "<unset>" if there is none (a missing or broken boot
# script), and so is every later change (a removal is "<unset>" too). Init
# scripts run before the document has an element, so the observer watches the
# whole document.
UNSET_THEME = "<unset>"
RECORD_THEMES = """
window.__themes = []
const note = (v) => { v = v || '<unset>'; if (window.__themes[window.__themes.length - 1] !== v) window.__themes.push(v) }
const root = () => document.documentElement
let painted = false
new MutationObserver((records) => {
  for (const r of records) if (r.type === 'attributes' && r.target === root()) note(root().getAttribute('data-theme'))
  if (!painted && document.body) { painted = true; note(root().getAttribute('data-theme')) }
}).observe(document, { attributes: true, attributeFilter: ['data-theme'], childList: true, subtree: true })
"""

# Every data-arrival value seen on an element (the reduced-motion fade lasts
# 120 ms, too short to poll for).
RECORD_ARRIVALS = """
window.__arrivals = []
const seen = (el) => {
  if (el.nodeType !== 1) return
  if (el.hasAttribute('data-arrival')) window.__arrivals.push(el.getAttribute('data-arrival'))
  for (const c of el.querySelectorAll('[data-arrival]')) window.__arrivals.push(c.getAttribute('data-arrival'))
}
new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'attributes') { if (r.target.hasAttribute('data-arrival')) window.__arrivals.push(r.target.getAttribute('data-arrival')) }
    else r.addedNodes.forEach(seen)
  }
}).observe(document, { attributes: true, attributeFilter: ['data-arrival'], childList: true, subtree: true })
"""


@pytest.fixture
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": VIEWPORT}


def _theme(page: Page) -> str:
    return page.evaluate("document.documentElement.dataset.theme")


def _switch_theme(page: Page, theme: str) -> None:
    page.get_by_role("group", name="Theme").get_by_role("button", name=THEME_LABELS[theme], exact=True).click()
    expect(page.locator("html")).to_have_attribute("data-theme", theme)
    page.wait_for_timeout(THEME_REVEAL_MS)


def _inspector_title(page: Page):
    return page.locator("aside[aria-label='Inspector'] h3")


def test_theme_switch_persists_without_flash(page: Page, local_server):
    base, _ = local_server
    page.add_init_script(RECORD_THEMES)
    page.goto(base)
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=15_000)
    _switch_theme(page, "phosphore")
    assert page.evaluate("localStorage.getItem('lanetrace-theme')") == "phosphore"

    page.reload()
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=15_000)
    assert page.evaluate("window.__themes") == ["phosphore"]
    assert _theme(page) == "phosphore"


def test_no_flash_recorder_catches_a_missing_boot_script(page: Page, local_server):
    """Guards the test above: without the boot script the first painted value is unset."""
    base, _ = local_server
    boot = re.compile(r"<script[^>]*>\(function\(\)\{var p=null;.*?</script>", re.S)

    def strip_boot_script(route):
        response = route.fetch()
        html, n = boot.subn("", response.text(), count=1)
        assert n == 1, "boot script not found in the page"
        route.fulfill(response=response, body=html)

    page.route(re.compile(r"^" + re.escape(base) + r"/?$"), strip_boot_script)
    page.add_init_script(RECORD_THEMES)
    page.goto(base)
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=15_000)
    themes = page.evaluate("window.__themes")
    assert themes[0] == UNSET_THEME and len(themes) == 2, themes


@pytest.mark.parametrize(("scheme", "expected"), [("dark", "cyanotype"), ("light", "studio")])
def test_auto_follows_system(new_context, local_server, scheme, expected):
    base, _ = local_server
    page = new_context(color_scheme=scheme).new_page()
    page.goto(base)
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=15_000)
    assert page.evaluate("localStorage.getItem('lanetrace-theme')") is None
    assert _theme(page) == expected


@pytest.mark.parametrize("theme", THEMES)
def test_run_view_each_theme_without_console_errors(new_context, local_server, theme):
    base, _ = local_server
    context = new_context()
    context.add_init_script(theme_init_script(theme))
    page = context.new_page()
    problems = watch_console(page)

    diagram = open_run(page, base)
    assert _theme(page) == theme
    first = diagram.locator("[data-event-id]").first
    expect(first).to_be_visible()
    first.click()
    expect(_inspector_title(page)).to_be_visible()
    page.wait_for_timeout(1_000)  # let the arrivals and the selection settle
    assert problems == []


def test_reduced_motion_live_event(new_context, local_server):
    base, db_url = local_server
    client = LaneTraceClient(db_url)
    run_id = client.create_run("e2e reduced motion", project="Customer Support Agent")
    client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call", label="calm first")

    context = new_context(reduced_motion="reduce")
    context.add_init_script(RECORD_ARRIVALS)
    page = context.new_page()
    diagram = open_run(page, base, "e2e reduced motion")
    expect(arrow(diagram, "calm first")).to_be_visible(timeout=10_000)
    page.evaluate("window.__arrivals.length = 0")

    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="calm second")
    expect(arrow(diagram, "calm second")).to_be_visible(timeout=8_000)
    wait_for(page, lambda: page.evaluate("window.__arrivals.length") > 0, "the new arrow's arrival")
    arrivals = page.evaluate("window.__arrivals")
    assert set(arrivals) == {"fade"}, arrivals


def test_theme_switch_mid_run_keeps_selection(page: Page, local_server):
    base, db_url = local_server
    client = LaneTraceClient(db_url)
    run_id = client.create_run("e2e switch mid run", project="Customer Support Agent")
    client.log_event(run_id, source="Orchestrator", target="LLM", type="llm_call", label="picked step")

    diagram = open_run(page, base, "e2e switch mid run")
    arrow(diagram, "picked step").click()
    expect(_inspector_title(page)).to_have_text("picked step")

    other = next(t for t in THEMES if t != _theme(page))
    _switch_theme(page, other)
    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="after switch")
    expect(arrow(diagram, "after switch")).to_be_visible(timeout=8_000)
    expect(_inspector_title(page)).to_have_text("picked step")
    assert _theme(page) == other


def test_many_participants_scrolls(page: Page, local_server):
    base, db_url = local_server
    client = LaneTraceClient(db_url)
    run_id = client.create_run("e2e crowded run", project="Research Assistant")
    names = [f"participant {i:02d} ".ljust(40, "x") for i in range(12)]
    assert all(len(n) == 40 for n in names)
    for i, target in enumerate(names[1:], start=1):
        client.log_event(run_id, source=names[0], target=target, type="handoff", label=f"hand off {i}")
    client.end_run(run_id, status="completed")

    problems = watch_console(page)
    diagram = open_run(page, base, "e2e crowded run")
    expect(arrow(diagram, "hand off 11")).to_be_attached()
    assert diagram.evaluate("el => el.scrollWidth > el.clientWidth")
    page.wait_for_timeout(500)
    assert problems == []


def test_large_run_opens_quickly(page: Page, local_server, record_property):
    base, db_url = local_server
    client = LaneTraceClient(db_url)
    run_id = client.create_run("e2e large run", project="Code Review Bot")
    steps = [("Orchestrator", "LLM", "llm_call"), ("Orchestrator", "search", "tool_call"), ("search", "Orchestrator", "tool_result")]
    for i in range(1_000):
        source, target, kind = steps[i % len(steps)]
        client.log_event(run_id, source=source, target=target, type=kind, label=f"step {i}")
    client.end_run(run_id, status="completed")

    # Timed from the click on the run's tile to its first arrow drawn: the
    # spec's "opens in under 500 ms on a mid-range laptop", with headroom for
    # CI runners. The page load before it (the 1.2 s boot sequence, the
    # dashboard's queries) isn't part of opening a run.
    page.goto(base)
    tile = page.locator("section[aria-labelledby='run-feed-title']").get_by_role(
        "button", name=re.compile(r"^e2e large run, ")
    )
    expect(tile).to_be_visible(timeout=15_000)
    start = time.monotonic()
    tile.click()
    diagram = page.get_by_test_id("diagram")
    expect(arrow(diagram, "step 0")).to_be_attached(timeout=5_000)
    elapsed = time.monotonic() - start
    print(f"opening a 1 000-event run took {elapsed:.2f} s")
    record_property("large_run_open_s", round(elapsed, 3))
    assert elapsed < 2.0, f"opening a 1 000-event run took {elapsed:.2f} s"

    arrow(diagram, "step 0").click(timeout=3_000)
    expect(_inspector_title(page)).to_have_text("step 0", timeout=3_000)

    drawn = diagram.locator("[data-event-id]").count()
    assert 0 < drawn < 200, f"{drawn} arrow groups in the DOM for 1 000 events"


def test_fresh_install_empty_states(page: Page, password_server):
    base, _ = password_server
    page.goto(base)
    page.get_by_role("tab", name="Create account").click()
    page.get_by_label("Name", exact=True).fill("Fresh User")
    page.get_by_label("Email", exact=True).fill("fresh@example.com")
    page.get_by_label("Password", exact=True).fill("secret123")
    page.get_by_role("button", name="Create account").click()

    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible(timeout=10_000)
    expect(page.get_by_text("No runs yet")).to_be_visible()
    page.get_by_role("button", name="Load demo projects").click()

    chronogram = page.locator("section[aria-labelledby='chronogram-title']")
    expect(chronogram.get_by_role("list", name="Projects").get_by_role("listitem").first).to_be_visible(timeout=10_000)
    feed = page.locator("section[aria-labelledby='run-feed-title']")
    expect(feed.get_by_role("button").first).to_be_visible(timeout=10_000)
    expect(page.get_by_text("No runs yet")).to_have_count(0)


def _settle(page: Page) -> None:
    page.evaluate("document.fonts.ready.then(() => true)")
    page.wait_for_timeout(600)


def test_capture_screenshots(new_context, local_server, password_server):
    """Always last: saves the dashboard, a run and the sign-in screen in each
    theme. Content is not asserted; a failed capture is skipped over."""
    base, _ = local_server
    signin_base, _ = password_server
    out = screenshot_dir()
    for theme in THEMES:
        context = new_context(reduced_motion="reduce")
        try:
            context.add_init_script(theme_init_script(theme))
            page = context.new_page()
            shots = {
                "dashboard": lambda p: (
                    p.goto(base),
                    p.locator("section[aria-labelledby='run-feed-title']").get_by_role("button").first.wait_for(timeout=15_000),
                ),
                "run": lambda p: open_run(p, base).locator("[data-event-id]").first.click(),
                "signin": lambda p: (
                    p.goto(signin_base),
                    p.get_by_role("tab", name="Create account").wait_for(timeout=15_000),
                ),
            }
            for name, prepare in shots.items():
                try:
                    prepare(page)
                    _settle(page)
                except Exception as exc:  # never fail on content
                    print(f"screenshot {name}-{theme}: {exc}")
                try:
                    page.screenshot(path=str(out / f"{name}-{theme}.png"))
                except Exception as exc:  # nor on the capture itself
                    print(f"screenshot {name}-{theme} not saved: {exc}")
        except Exception as exc:  # e.g. the page could not be opened at all
            print(f"screenshots for {theme} skipped: {exc}")
        finally:
            context.close()
