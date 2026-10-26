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


def open_tab(page, area, tab):
    """Show a tab of the Control or the Edit area."""
    page.get_by_role("tab", name=area, exact=True).click()
    page.get_by_role("tab", name=tab, exact=True).click()


def sidebar_state(page):
    """The value next to "State:" in the side panel's CamillaDSP box."""
    label = page.locator(".sidepanel").get_by_text("State:", exact=True)
    return label.locator("xpath=following-sibling::div[1]")


def test_the_area_is_remembered(page, server):
    """Control is the default, the area picked is kept over a reload, and the bookmarks of
    the old compact and dashboard views open Control."""
    expect(page.get_by_role("tab", name="Overview", exact=True)).to_be_visible()
    page.get_by_role("tab", name="Edit", exact=True).click()
    page.reload()
    expect(page.get_by_role("tab", name="Pipeline", exact=True)).to_be_visible()
    page.goto(f"http://127.0.0.1:{server.port}/gui/index.html?compactview")
    expect(page.get_by_role("tab", name="Overview", exact=True)).to_be_visible()
    assert "compactview" not in page.url


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
    open_tab(page, "Control", "Files")
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
    open_tab(page, "Control", "Files")
    expect(page.get_by_text("config2.yml", exact=True).first).to_be_visible()
    second = page.context.new_page()
    second.goto(page.url)
    open_tab(second, "Control", "Files")
    expect(second.get_by_text("config2.yml", exact=True).first).to_be_visible()


def test_five_gui_tabs_leave_room_for_requests(page, server):
    """Each GUI tab holds one connection with its event stream, whatever it
    shows. Four tabs with the spectrum on the overview, the levels and the
    state leave room for a fifth to list its files."""
    url = f"http://127.0.0.1:{server.port}/gui/index.html"
    for index in range(4):
        tab = page if index == 0 else page.context.new_page()
        tab.goto(url)
        tab.locator('[data-tooltip-html="Show spectrum"]').click()
        expect(tab.locator('[data-tooltip-html="Hide spectrum"]')).to_be_visible()
    wait_for(lambda: len(server.fake.commands("SubscribeSpectrum")) >= 4)
    fifth = page.context.new_page()
    fifth.goto(url)
    open_tab(fifth, "Control", "Files")
    expect(fifth.get_by_text("config2.yml", exact=True).first).to_be_visible()


def test_config_with_errors_loads_into_the_gui(page, server):
    """A config CamillaDSP would refuse still loads, so it can be fixed in the GUI."""
    config = yaml.safe_load((server.config_dir / "config2.yml").read_text())
    config["pipeline"] = [{"type": "Filter", "channels": [0], "names": ["nosuchfilter"]}]
    (server.config_dir / "errors_tmp.yml").write_text(yaml.dump(config))
    try:
        open_tab(page, "Control", "Files")
        page.locator("""[data-tooltip-html='Load "errors_tmp.yml" into the editor.']""").click()
        # Loading switches to the editor.
        page.get_by_role("tab", name="Pipeline").click()
        expect(page.get_by_text("nosuchfilter").first).to_be_visible()
        expect(page.locator(".editor-toolbar .config-status")).not_to_have_text("OK")
    finally:
        (server.config_dir / "errors_tmp.yml").unlink()


def test_save_as_from_the_editor_toolbar(page, server):
    """Saving under a new name makes it the editor's file, and an existing name asks first."""
    page.get_by_role("tab", name="Edit", exact=True).click()
    toolbar = page.locator(".editor-toolbar")
    save_as = toolbar.locator(".button", has_text="Save as")
    saved = server.config_dir / "saved_tmp.yml"
    # The name prompt, then the overwrite question for an existing file, which is declined.
    answers = ["saved_tmp.yml", "config2.yml", None]

    def answer(dialog):
        reply = answers.pop(0)
        if reply is None:
            dialog.dismiss()
        else:
            dialog.accept(reply)

    page.on("dialog", answer)
    try:
        save_as.click()
        wait_for(lambda: saved.exists())
        expect(toolbar.locator(".editor-toolbar-file")).to_contain_text("saved_tmp.yml")
        before = (server.config_dir / "config2.yml").read_text()
        save_as.click()
        # Dialogs are only handled while Playwright runs, which time.sleep doesn't.
        deadline = time.time() + 5
        while answers:
            assert time.time() < deadline
            page.wait_for_timeout(50)
        page.wait_for_timeout(500)
        assert (server.config_dir / "config2.yml").read_text() == before
        expect(toolbar.locator(".editor-toolbar-file")).to_contain_text("saved_tmp.yml")
    finally:
        saved.unlink(missing_ok=True)


def test_zip_download_goes_to_the_browser(page, server, tmp_path):
    """The zip is a native download, and a refusal still shows its message."""
    gone = server.config_dir / "gone.yml"
    shutil.copy(server.config_dir / "config2.yml", gone)
    open_tab(page, "Control", "Files")
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
    open_tab(page, "Edit", "Devices")
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
    page.goto(f"http://127.0.0.1:{server.port}/gui/index.html")
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
        open_tab(page, "Control", "Files")
        # Loading switches to the editor.
        page.locator("""[data-tooltip-html='Load "wide_tmp.yml" into the editor.']""").click()
        page.get_by_role("tab", name="Filters").click()
        page.locator('[data-tooltip-html="Plot frequency response of this filter"]').first.click()
        expect(page.locator("canvas").first).to_be_visible()
        tabs = page.locator(".react-tabs__tab:not(.react-tabs__tab--disabled)")
        names = {}
        for area in ("Control", "Edit"):
            page.get_by_role("tab", name=area, exact=True).click()
            names[area] = [name.strip() for name in tabs.all_inner_texts()]
        for width in (1600, 1280, 1024, 768, 390):
            page.set_viewport_size({"width": width, "height": 900})
            for area, area_names in names.items():
                page.get_by_role("tab", name=area, exact=True).click()
                for name in area_names:
                    page.get_by_role("tab", name=name, exact=True).click()
                    # The mixer matrix starts to scroll once it has been measured
                    deadline = time.time() + 2
                    while (sticking_out := page.evaluate(STICKING_OUT)) and time.time() < deadline:
                        time.sleep(0.05)
                    assert sticking_out == [], f"{area}, {name} at {width} px"
    finally:
        (server.config_dir / "wide_tmp.yml").unlink()
        context.close()
    assert errors == []


def test_config_and_volume_reach_camilladsp(page, server):
    page.get_by_role("tab", name="Edit", exact=True).click()
    sidepanel = page.locator(".sidepanel")
    # The startup config came from CamillaDSP, and the backend found nothing wrong with it.
    expect(page.locator(".editor-toolbar .config-status")).to_have_text("OK")
    page.locator(".editor-toolbar").get_by_text("Apply to DSP", exact=True).click()
    wait_for(lambda: server.fake.commands("SetConfigJson"))
    # The volume box only sends a change once it has read the volume.
    wait_for(lambda: server.fake.commands("GetMute"))
    sidepanel.locator('[data-tooltip-html="Mute"]').click()
    wait_for(lambda: server.fake.state["mute"] is True)
    sidepanel.locator('[data-tooltip-html="Lower volume by 1 dB"]').click()
    wait_for(lambda: server.fake.state["volume"] == -21.0)


def with_controller(page, server):
    """Give the fake CamillaDSP a controller running config.yml from files, and load the GUI again."""
    path = str(server.config_dir / "config.yml")
    server.fake.state["controller"] = {
        "settings": None,
        "status": {
            "source": "Files",
            "provider": "Single",
            "config_file": path,
            "startup_config_file": path,
            "recovering": False,
            "attempts": 0,
            "next_retry_s": None,
            "waiting_for_source": None,
            "following": False,
            "error_recovery": False,
            "stop_reason": "None",
        },
        "checks": {
            "adapt": {
                "file": path,
                "samplerate": 44100,
                "alternate_samplerates": [96000],
                "channels": 2,
                "format": None,
                "problem": None,
                "warnings": [],
            },
        },
    }
    page.reload()
    source = page.locator(".sidepanel").get_by_text("Source:", exact=True).locator("xpath=following-sibling::div[1]")
    expect(source).to_have_text("file, as written")
    return source


def test_apply_to_dsp_runs_file_less_until_a_file_is_run(page, server):
    source = with_controller(page, server)
    page.get_by_role("tab", name="Edit", exact=True).click()
    page.locator(".editor-toolbar").get_by_text("Apply to DSP", exact=True).click()
    wait_for(lambda: server.fake.commands("SetConfigJson"))
    expect(source).to_have_text("file-less")
    expect(page.locator(".sidepanel").get_by_text("Not saved to any file", exact=False)).to_be_visible()
    open_tab(page, "Control", "Configs")
    # The startup config is marked with a star.
    page.locator(".tabpanel").get_by_text("★ config.yml", exact=True).click()
    wait_for(lambda: server.fake.commands("Reload"))
    expect(source).to_have_text("file, as written")


def test_apply_automatically_leaves_files_alone(page, server):
    source = with_controller(page, server)
    open_tab(page, "Edit", "Title")
    page.locator(".editor-toolbar").get_by_text("Apply automatically").click()
    page.locator('[data-tooltip-html="Optional title for the configuration"]').fill("Edited")
    # Well past the delay before an automatic apply.
    time.sleep(1.5)
    assert not server.fake.commands("SetConfigJson")
    expect(source).to_have_text("file, as written")


def test_a_config_file_runs_with_one_click(page, server):
    """It becomes the startup config, runs from files, and is loaded into the editor."""
    with_controller(page, server)
    open_tab(page, "Control", "Configs")
    page.locator(".tabpanel").get_by_text("config2.yml", exact=True).click()
    wait_for(lambda: server.fake.state["config_file_path"] == str(server.config_dir / "config2.yml"))
    wait_for(lambda: server.fake.commands("Reload"))
    page.get_by_role("tab", name="Edit", exact=True).click()
    expect(page.locator(".editor-toolbar-file")).to_contain_text("config2.yml")


def test_following_applies_at_once(page, server):
    with_controller(page, server)
    open_tab(page, "Control", "Configs")
    page.get_by_text("Follow the capture device", exact=True).click()
    wait_for(lambda: server.fake.commands("Reload"))
    assert server.fake.state["controller"]["settings"] == {"follow_capture": True, "error_recovery": None}


def test_following_is_only_stored_while_file_less(page, server):
    """Turning it on doesn't reload, which would drop the config applied from the editor."""
    with_controller(page, server)
    server.fake.state["controller"]["status"].update(source="Websocket", provider=None, config_file=None)
    open_tab(page, "Control", "Configs")
    expect(page.get_by_text("(when running from files)", exact=True)).to_be_visible()
    page.locator(".tabpanel input[type=checkbox]").first.click()
    wait_for(lambda: server.fake.state["controller"]["settings"] == {"follow_capture": True, "error_recovery": None})
    assert not server.fake.commands("Reload")


def test_the_command_line_shows_in_after_a_restart(page, server):
    # The startup args are read once per connection, so the fake starts again with them.
    server.fake.go_offline()
    server.fake.state["startup_args"] = {
        "statefile": "/state.yml",
        "config_file": str(server.config_dir / "config.yml"),
        "no_config": False,
        "wait": True,
        "follow_capture": True,
        "error_recovery": False,
        "samplerate": None,
        "channels": None,
        "extra_samples": None,
        "sample_format": None,
        "volume": [None, None, None, None, None],
        "mute": [False, False, False, False, False],
    }
    server.fake.state["online"] = True
    wait_for(lambda: server.get("/api/param/volume").status == 200)
    wait_for(lambda: server.get("/api/status").json()["startup_args"] is not None)
    with_controller(page, server)
    open_tab(page, "Control", "Overview")
    panel = page.locator(".tabpanel")
    expect(panel.get_by_text("After a restart", exact=True)).to_be_visible()
    # The startup config and following.
    expect(panel.get_by_text("(set on the command line)", exact=True)).to_have_count(2)
    expect(panel.get_by_text("(from the statefile)", exact=True)).to_have_count(1)
    open_tab(page, "Control", "Configs")
    expect(panel.get_by_text("The command line gives config.yml, a restart goes back to it.")).to_be_visible()
    expect(panel.get_by_text("The command line gives --follow_capture", exact=False)).to_be_visible()
    # Offline again, so the next reset reconnects to a CamillaDSP without them.
    server.fake.go_offline()


def test_the_startup_config_is_checked_with_following_off(page, server):
    with_controller(page, server)
    open_tab(page, "Control", "Configs")
    page.get_by_text("Check the startup config", exact=True).click()
    check = page.locator(".tabpanel table")
    expect(check.get_by_text("config.yml", exact=True)).to_be_visible()
    expect(check.get_by_text("96000", exact=True)).to_be_visible()
