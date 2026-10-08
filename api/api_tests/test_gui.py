"""
The GUI in a headless browser, against the real backend and a fake CamillaDSP.

Only for what the API tests cannot see, such as a value going all the way from
CamillaDSP through an event stream to the screen. Keep them few, a browser
test costs far more than an API test.
"""

import shutil
import time
import zipfile

import pytest

pytest.importorskip("playwright.sync_api", reason="Playwright is not installed")
from playwright.sync_api import expect  # noqa: E402

# The state only comes by the /api/state stream, which should show a change
# well within one 500 ms status poll.
STREAMED = 400


def wait_for(condition, timeout=5):
    deadline = time.time() + timeout
    while not condition():
        assert time.time() < deadline
        time.sleep(0.05)


def sidebar_state(page):
    """The value next to "State:" in the side panel's CamillaDSP box."""
    label = page.locator(".sidepanel").get_by_text("State:", exact=True)
    return label.locator("xpath=following-sibling::div[1]")


def test_state_changes_show_at_once(page, server):
    state = sidebar_state(page)
    expect(state).to_have_text("Running")
    server.fake.state["state"] = "Paused"
    expect(state).to_have_text("Paused", timeout=STREAMED)
    server.fake.state["state"] = "Inactive"
    expect(state).to_have_text("Inactive", timeout=STREAMED)


def test_offline_when_camilladsp_goes_away(page, server):
    state = sidebar_state(page)
    expect(state).to_have_text("Running")
    server.fake.go_offline()
    # The state stream ends with the connection, before the status notices.
    expect(state).to_have_text("Offline", timeout=STREAMED)


def test_files_tab_lists_the_files(page, server):
    page.get_by_role("tab", name="Files").click()
    expect(page.get_by_text("config2.yml", exact=True).first).to_be_visible()


def test_zip_download_goes_to_the_browser(page, server, tmp_path):
    """The zip is a native download, and a refusal still shows its message."""
    gone = server.config_dir / "gone.yml"
    shutil.copy(server.config_dir / "config2.yml", gone)
    page.get_by_role("tab", name="Files").click()
    configs = page.locator(".box").filter(has_text="config2.yml").first
    rows = configs.get_by_role("row")
    download_button = configs.locator('[data-tooltip-html="Download 1 file as zip file"]')

    rows.filter(has_text="gone.yml").locator("input[type=checkbox]").check()
    gone.unlink()
    download_button.click()
    expect(configs.get_by_text("Could not read gone.yml", exact=False)).to_be_visible()

    rows.filter(has_text="gone.yml").locator("input[type=checkbox]").uncheck()
    rows.filter(has_text="config2.yml").locator("input[type=checkbox]").check()
    with page.expect_download() as download_info:
        download_button.click()
    download = download_info.value
    assert download.suggested_filename == "configs.zip"
    download.save_as(tmp_path / "configs.zip")
    archive = zipfile.ZipFile(tmp_path / "configs.zip")
    assert archive.read("config2.yml") == (server.config_dir / "config2.yml").read_bytes()


def test_device_capabilities_show_the_supported_rates(page, server):
    page.get_by_role("tab", name="Devices").click()
    page.locator('label[data-tooltip-html="Audio backend for capture"] select').select_option("Alsa")
    page.locator('[data-tooltip-html="Pick a device"]').first.click()
    page.get_by_text("hw:Aaaa,0,0: Dev A", exact=True).click()
    page.locator('[data-tooltip-html="Inspect device capabilities"]').first.click()
    rates = page.locator(".device-capabilities-supported-rates-item")
    expect(rates).to_have_count(1)
    expect(rates.first).to_contain_text("44100")


def test_config_and_volume_reach_camilladsp(page, server):
    sidepanel = page.locator(".sidepanel")
    # The startup config came from CamillaDSP, and the backend found nothing wrong with it.
    expect(sidepanel.locator(".config-status")).to_have_text("OK")
    sidepanel.get_by_text("Apply to DSP", exact=True).click()
    wait_for(lambda: server.fake.commands("SetConfigJson"))
    # The volume box only sends a change once it has read the volume.
    wait_for(lambda: server.fake.commands("GetMute"))
    sidepanel.locator('[data-tooltip-html="Mute"]').click()
    wait_for(lambda: server.fake.state["mute"] is True)
    sidepanel.locator('[data-tooltip-html="Lower volume by 1 dB"]').click()
    wait_for(lambda: server.fake.state["volume"] == -21.0)
