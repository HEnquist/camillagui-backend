import React from "react"
import "../index.css"
import isEqual from "lodash/isEqual"
import camillalogo from "./camilladsp.svg"
import {VolumeBox} from "./volumebox"
import {Box, Button, delayedExecutor, SuccessFailureButton} from "../utilities/ui-components"
import {Config} from "../camilladsp/config"
import {GuiConfig} from "../guiconfig"
import {LogFileViewerPopup} from "./logfileviewer"
import {defaultStatus, isBackendOnline, isCdspOffline, isCdspOnline, Status, StatusPoller} from "../camilladsp/status"
import {VersionLabels} from "../camilladsp/versions"
import {Configcheckmessage} from "./configcheckmessage"

interface SidePanelProps {
  config: Config
  guiConfig: GuiConfig
  applyConfig: () => Promise<void>
  fetchConfig: () => Promise<void>
  setErrors: (errors: any) => void
  currentConfigFile?: string
  message: string
}

export class SidePanel extends React.Component<
  SidePanelProps,
  {
    cdspStatus: Status
    applyConfigAutomatically: boolean
    msg: string
    logFileViewerOpen: boolean
  }
> {

  private statusPoller = new StatusPoller(cdspStatus => this.setState({cdspStatus}), this.props.guiConfig.status_update_interval)

  private timer = delayedExecutor(500)

  constructor(props: SidePanelProps) {
    super(props)
    this.state = {
      cdspStatus: defaultStatus(),
      applyConfigAutomatically: props.guiConfig.apply_config_automatically,
      msg: '',
      logFileViewerOpen: false
    }
  }

  componentWillUnmount() {
    this.statusPoller.stop()
  }

  componentDidUpdate(prevProps: { config: Config, guiConfig: GuiConfig }) {
    const {apply_config_automatically} = this.props.guiConfig
    if (apply_config_automatically !== prevProps.guiConfig.apply_config_automatically)
      this.setState({applyConfigAutomatically: apply_config_automatically})
    const {status_update_interval} = this.props.guiConfig
    if (status_update_interval !== prevProps.guiConfig.status_update_interval)
      this.statusPoller.set_interval(status_update_interval);
    if (this.state.applyConfigAutomatically && !isEqual(prevProps.config, this.props.config))
      this.timer(() => {
        this.props.applyConfig().catch(() => {})
      })
  }

  render() {
    return (
      <section className="tabpanel" style={{width: '250px'}}>
        <img src={camillalogo} alt="graph" width="100%" height="100%"/>
        {isCdspOnline(this.state.cdspStatus)
            && <VolumeBox
                    vuMeterStatus={this.state.cdspStatus}
                    setMessage={message => this.setState({msg: message})}/>
        }
        {this.cdspStateBox()}
        {this.configBox()}
        <VersionLabels versions={this.state.cdspStatus}/>
      </section>
    )
  }

  private cdspStateBox() {
    const status = this.state.cdspStatus
    return <Box title="CamillaDSP">
      <div className="two-column-grid" style={{gridTemplateColumns: 'max-content auto'}}>
        <div className="alignRight">State:</div>
        <div>{status.cdsp_status}</div>
        <div className="alignRight">Capture samplerate:</div>
        <div>{status.capturerate}</div>
        <div className="alignRight">Rate adjust:</div>
        <div>{status.rateadjust}</div>
        <div className="alignRight">Clipped samples:</div>
        <div>{status.clippedsamples}</div>
        <div className="alignRight">Buffer level:</div>
        <div>{status.bufferlevel}</div>
        <div className="alignRight">Message:</div>
        <div>{this.props.message}</div>
      </div>
      <Button
          text="Show log file"
          onClick={() => this.setState({logFileViewerOpen: true})}
          style={{marginTop: '10px'}}
          enabled={isBackendOnline(status)}
      />
      <LogFileViewerPopup open={this.state.logFileViewerOpen}
                          onClose={() => this.setState({logFileViewerOpen: false})}/>
    </Box>
  }

  private configBox() {
    const status = this.state.cdspStatus
    const cdsp_online = isCdspOnline(status)
    const activeConfigFile = this.props.currentConfigFile
    let applyButtonText = 'Apply to DSP'
    let applyButtonTooltip = 'Apply config to the running CamillaDSP process'
    if (cdsp_online && activeConfigFile)
      applyButtonTooltip = `Apply config to the running CamillaDSP process, and save to ${activeConfigFile}`
    else if (isCdspOffline(status)) {
      applyButtonText = "Save config"
      applyButtonTooltip = `Save config to ${activeConfigFile}`
    }
    return <Box title="Config">
      {activeConfigFile &&
        <div style={{width: '220px', overflowWrap: 'break-word', textAlign: 'center', margin: '0 auto 5px'}}>
          {activeConfigFile}
        </div>
      }
      <div className="two-column-grid">
        <SuccessFailureButton
            enabled={cdsp_online}
            text="Fetch from DSP"
            data-tip="Fetch active config from the running CamillaDSP process"
            onClick={this.props.fetchConfig}/>
        <SuccessFailureButton
            enabled={isBackendOnline(status) && !this.state.applyConfigAutomatically}
            text={applyButtonText}
            data-tip={applyButtonTooltip}
            onClick={this.props.applyConfig}/>
      </div>
      <div style={{textAlign: 'center', marginTop: '5px'}}>
        Apply automatically <input
          value={"asdf"}
          style={{}}
          type="checkbox"
          checked={this.state.applyConfigAutomatically}
          data-tip="Save/Apply config automatically after each change"
          onChange={(e) => this.setState({applyConfigAutomatically: e.target.checked})}/>
      </div>
      <Configcheckmessage config={this.props.config} setErrors={this.props.setErrors}/>
    </Box>
  }
}