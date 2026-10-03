from playwright.sync_api import Page, expect

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
    page.get_by_text("e2e live run", exact=True).first.click()
    expect(page.get_by_text("first step").first).to_be_visible(timeout=10_000)

    client.log_event(run_id, source="Orchestrator", target="web_search", type="tool_call", label="live arrow")
    expect(page.get_by_text("live arrow").first).to_be_visible(timeout=5_000)


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
