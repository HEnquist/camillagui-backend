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
import yaml

pytest.importorskip("playwright.sync_api", reason="Playwright is not installed")
from playwright.sync_api import expect  # noqa: E402

# The state only comes by the /api/events stream, which should show a change
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
    """Also those added and removed behind the GUI's back, which it notices
    by polling /api/files/fingerprints, within a check or so."""
    page.get_by_role("tab", name="Files").click()
    expect(page.get_by_text("config2.yml", exact=True).first).to_be_visible()
    added = server.config_dir / "added_tmp.yml"
    shutil.copy(server.config_dir / "config2.yml", added)
    try:
        expect(page.get_by_text("added_tmp.yml", exact=True).first).to_be_visible(timeout=4000)
    finally:
        added.unlink()
    expect(page.get_by_text("added_tmp.yml", exact=True)).to_have_count(0, timeout=4000)


def test_files_tab_in_a_second_gui_tab(page, server):
    """A browser has six connections to the backend for all its tabs, and each
    open event stream holds one, so a second GUI tab must leave room for its
    requests."""
    page.get_by_role("tab", name="Files").click()
    expect(page.get_by_text("config2.yml", exact=True).first).to_be_visible()
    second = page.context.new_page()
    second.goto(page.url)
    second.get_by_role("tab", name="Files").click()
    expect(second.get_by_text("config2.yml", exact=True).first).to_be_visible()


def test_five_gui_tabs_leave_room_for_requests(page, server):
    """Each GUI tab holds one connection with its event stream, whatever it
    shows. Four tabs with the spectrum, the levels and the state on the
    dashboard leave room for a fifth to list its files."""
    url = f"http://127.0.0.1:{server.port}/gui/index.html"
    for index in range(4):
        tab = page if index == 0 else page.context.new_page()
        tab.goto(f"{url}?dashboardview")
        tab.locator('[data-tooltip-html="Show spectrum"]').click()
        expect(tab.locator('[data-tooltip-html="Hide spectrum"]')).to_be_visible()
    wait_for(lambda: len(server.fake.commands("SubscribeSpectrum")) >= 4)
    fifth = page.context.new_page()
    fifth.goto(url)
    fifth.get_by_role("tab", name="Files").click()
    expect(fifth.get_by_text("config2.yml", exact=True).first).to_be_visible()


def test_config_with_errors_loads_into_the_gui(page, server):
    """A config CamillaDSP would refuse still loads, so it can be fixed in the GUI."""
    config = yaml.safe_load((server.config_dir / "config2.yml").read_text())
    config["pipeline"] = [{"type": "Filter", "channels": [0], "names": ["nosuchfilter"]}]
    (server.config_dir / "errors_tmp.yml").write_text(yaml.dump(config))
    try:
        page.get_by_role("tab", name="Files").click()
        page.locator("""[data-tooltip-html='Load "errors_tmp.yml" into the GUI.']""").click()
        page.get_by_role("tab", name="Pipeline").click()
        expect(page.get_by_text("nosuchfilter").first).to_be_visible()
        expect(page.locator(".sidepanel .config-status")).not_to_have_text("OK")
    finally:
        (server.config_dir / "errors_tmp.yml").unlink()


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


# What sticks out past the right edge of the window: the page itself, or anything visible on the
# selected tab outside of the boxes that scroll sideways on purpose.
STICKING_OUT = """() => {
  const out = []
  if (document.documentElement.scrollWidth > window.innerWidth)
    out.push("page: " + document.documentElement.scrollWidth)
  const panel = document.querySelector(".react-tabs__tab-panel--selected")
  for (const element of panel.querySelectorAll("*")) {
    if (element.closest(".scroll-x, .data-table-shell")) continue
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && rect.right > window.innerWidth + 1)
      out.push(element.outerHTML.slice(0, 80) + ": " + Math.round(rect.right))
  }
  return out
}"""


@pytest.mark.parametrize("touch", [False, True], ids=["mouse", "touch"])
def test_no_tab_is_wider_than_the_window(browser, server, touch):
    """At any window width, down to a phone's. Catches a fixed width that
    sneaks back in, which the tests at a desktop size would not notice. With a
    touch screen too, where buttons and inputs are larger."""
    context = browser.new_context(is_mobile=touch, has_touch=touch)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(error))
    # A phone opens in the compact view, the tabs are in the normal one
    page.goto(f"http://127.0.0.1:{server.port}/gui/index.html?normalview")
    config = yaml.safe_load((server.config_dir / "config2.yml").read_text())
    config["devices"]["capture"]["channels"] = 8
    config["filters"] = {
        "lowpass": {"type": "Biquad", "parameters": {"type": "Lowpass", "freq": 1000, "q": 0.5}}
    }
    config["mixers"] = {
        "downmix": {
            "channels": {"in": 8, "out": 2},
            "mapping": [
                {"dest": dest, "sources": [{"channel": src, "gain": 0} for src in range(8)]}
                for dest in range(2)
            ],
        }
    }
    config["processors"] = {
        "comp": {
            "type": "Compressor",
            "parameters": {
                "channels": 2,
                "attack": 0.025,
                "attack_unit": "s",
                "release": 1.0,
                "release_unit": "s",
                "threshold": -25,
                "factor": 5.0,
            },
        }
    }
    config["pipeline"] = [
        {"type": "Mixer", "name": "downmix"},
        {"type": "Filter", "channels": [0, 1], "names": ["lowpass"]},
        {"type": "Processor", "name": "comp"},
    ]
    (server.config_dir / "wide_tmp.yml").write_text(yaml.dump(config))
    try:
        page.get_by_role("tab", name="Files").click()
        page.locator("""[data-tooltip-html='Load "wide_tmp.yml" into the GUI.']""").click()
        page.get_by_role("tab", name="Filters").click()
        page.locator('[data-tooltip-html="Plot frequency response of this filter"]').first.click()
        expect(page.locator("canvas").first).to_be_visible()
        tabs = page.locator(".react-tabs__tab:not(.react-tabs__tab--disabled)")
        names = [name.strip() for name in tabs.all_inner_texts()]
        for width in (1600, 1280, 1024, 768, 390):
            page.set_viewport_size({"width": width, "height": 900})
            for name in names:
                page.get_by_role("tab", name=name, exact=True).click()
                # The mixer matrix starts to scroll once it has been measured
                deadline = time.time() + 2
                while (sticking_out := page.evaluate(STICKING_OUT)) and time.time() < deadline:
                    time.sleep(0.05)
                assert sticking_out == [], f"{name} at {width} px"
    finally:
        (server.config_dir / "wide_tmp.yml").unlink()
        context.close()
    assert errors == []


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
