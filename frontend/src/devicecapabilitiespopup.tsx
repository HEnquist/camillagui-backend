import React, { useEffect, useState } from "react"
import ReactjsPopup from "reactjs-popup"
import { getFormatOptions } from "./camilladsp/config"
import { CloseButton } from "./utilities/ui-components"

export type DeviceCapabilitySamplerate = {
  samplerate: number
  formats: string[]
}

export type DeviceChannelCapability = {
  channels: number
  samplerates: DeviceCapabilitySamplerate[]
}

export type DeviceCapabilities = {
  name: string
  description: string
  capabilities: DeviceChannelCapability[]
}

function normalizeCapabilityFormat(backend: string, format: string): string | null {
  const directMatch = getFormatOptions(backend).find((entry) => entry.value === format)
  if (directMatch) {
    return format
  }
  return null
}

function normalizeCapabilityFormats(backend: string, supportedFormats: string[]): string[] {
  const normalized = new Set<string>()
  supportedFormats.forEach((format) => {
    const mapped = normalizeCapabilityFormat(backend, format)
    if (mapped !== null) {
      normalized.add(mapped)
    }
  })
  return Array.from(normalized)
}

function backendSupportsOptionalFormat(backend: string): boolean {
  return getFormatOptions(backend).some((entry) => entry.value === null)
}

function getSupportedFormatOptions(
  backend: string,
  supportedFormats: string[],
  includeOptionalFormat: boolean,
): { value: string | null; label: string }[] {
  const normalizedFormats = normalizeCapabilityFormats(backend, supportedFormats)
  return getFormatOptions(backend).filter((entry) => {
    if (entry.value === null) {
      return includeOptionalFormat
    }
    return normalizedFormats.includes(entry.value)
  })
}

function getCapabilitiesForSamplerate(capabilities: DeviceCapabilities | null, samplerate: number | null) {
  if (capabilities === null || samplerate === null) {
    return []
  }
  return capabilities.capabilities
    .map((entry) => ({
      channels: entry.channels,
      formats: entry.samplerates.find((rateEntry) => rateEntry.samplerate === samplerate)?.formats ?? [],
    }))
    .filter((entry) => entry.formats.length > 0)
}

function getCompatibleChannels(
  rateCapabilities: { channels: number; formats: string[] }[],
  selectedFormat: string | null,
): number[] {
  return rateCapabilities
    .filter((entry) => selectedFormat === null || entry.formats.includes(selectedFormat))
    .map((entry) => entry.channels)
}

function getCompatibleFormats(
  rateCapabilities: { channels: number; formats: string[] }[],
  selectedChannels: number | null,
): string[] {
  const allFormats = new Set<string>()
  rateCapabilities
    .filter((entry) => selectedChannels === null || entry.channels === selectedChannels)
    .forEach((entry) => entry.formats.forEach((format) => allFormats.add(format)))
  return Array.from(allFormats)
}

function getSupportedSamplerates(capabilities: DeviceCapabilities | null): number[] {
  if (capabilities === null) {
    return []
  }
  const samplerates = new Set<number>()
  capabilities.capabilities.forEach((channelCapability) => {
    channelCapability.samplerates.forEach((samplerateCapability) => {
      samplerates.add(samplerateCapability.samplerate)
    })
  })
  return Array.from(samplerates).sort((left, right) => left - right)
}

function getProbeErrorMessage(fetchError: string | null): string | null {
  if (fetchError === null) {
    return null
  }
  const normalizedError = fetchError.trim().toLowerCase()
  if (normalizedError === "device busy" || normalizedError === "device is busy") {
    return "The device is busy and cannot be probed right now. Stop whatever is currently using the device, then try probing again."
  }
  if (normalizedError === "device not found") {
    return "The selected device was not found. There is no such device."
  }
  return fetchError
}

export function DeviceCapabilitiesPopup(props: {
  open: boolean
  header: string
  backend: string
  deviceName: string | null
  capabilities: DeviceCapabilities | null
  fetchError: string | null
  samplerate: number | null
  samplerateDescription: string
  channels: number
  format: string | null
  onClose: () => void
  onApply: (channels: number, format: string | null) => void
}) {
  const [pendingChannels, setPendingChannels] = useState<number | null>(null)
  const [pendingFormat, setPendingFormat] = useState<string | null>(null)
  const rateCapabilities = getCapabilitiesForSamplerate(props.capabilities, props.samplerate)
  const supportedSamplerates = getSupportedSamplerates(props.capabilities)
  const rateSupported = props.samplerate !== null && rateCapabilities.length > 0
  const allFormats = normalizeCapabilityFormats(props.backend, getCompatibleFormats(rateCapabilities, null))
  const allChannels = getCompatibleChannels(rateCapabilities, null)
  const allFormatsKey = allFormats.join("|")
  const allChannelsKey = allChannels.join("|")
  const activeFormat = pendingFormat !== null && allFormats.includes(pendingFormat) ? pendingFormat : null
  const activeChannels = pendingChannels !== null && allChannels.includes(pendingChannels) ? pendingChannels : null
  const compatibleChannels = getCompatibleChannels(rateCapabilities, activeFormat)
  const compatibleFormats = normalizeCapabilityFormats(
    props.backend,
    getCompatibleFormats(rateCapabilities, activeChannels),
  )
  const optionalFormat = backendSupportsOptionalFormat(props.backend)
  const compatibleFormatOptions = getSupportedFormatOptions(props.backend, compatibleFormats, optionalFormat)
  const displayedChannels = activeChannels ?? compatibleChannels[0] ?? null
  const probeErrorMessage = getProbeErrorMessage(props.fetchError)

  useEffect(() => {
    if (!props.open) {
      return
    }
    setPendingChannels(allChannels.includes(props.channels) ? props.channels : null)
    setPendingFormat(props.format !== null && allFormats.includes(props.format) ? props.format : null)
  }, [props.open, props.channels, props.format, allChannelsKey, allFormatsKey])

  useEffect(() => {
    if (pendingChannels !== null && !compatibleChannels.includes(pendingChannels)) {
      setPendingChannels(compatibleChannels.length > 0 ? compatibleChannels[0] : null)
    }
  }, [pendingChannels, compatibleChannels])

  useEffect(() => {
    if (pendingFormat !== null && !compatibleFormats.includes(pendingFormat)) {
      setPendingFormat(compatibleFormats.length > 0 ? compatibleFormats[0] : null)
    }
  }, [pendingFormat, compatibleFormats])

  const canApply = rateSupported && activeChannels !== null && (activeFormat !== null || optionalFormat)

  return (
    <ReactjsPopup
      open={props.open}
      closeOnDocumentClick={true}
      onClose={props.onClose}
      contentStyle={{ width: "max-content" }}
    >
      <div className="device-capabilities-popup">
        <div className="device-capabilities-header">
          <div>
            <div className="device-capabilities-title">{props.header}</div>
            {props.deviceName && <div className="device-capabilities-subtitle">{props.deviceName}</div>}
            {props.capabilities?.description && props.capabilities.description !== props.deviceName && (
              <div className="device-capabilities-subtitle">{props.capabilities.description}</div>
            )}
          </div>
          <CloseButton onClick={props.onClose} />
        </div>
        {probeErrorMessage && <div className="device-capabilities-warning">{probeErrorMessage}</div>}
        {props.samplerate === null && (
          <div className="device-capabilities-warning">No active samplerate is set for this device.</div>
        )}
        {props.samplerate !== null && !rateSupported && !probeErrorMessage && (
          <div className="device-capabilities-warning">
            The device does not report support for {props.samplerate} Hz.
          </div>
        )}
        {supportedSamplerates.length > 0 && (
          <div className="device-capabilities-supported-rates">
            <div className="device-capabilities-supported-rates-title">Supported sample rates</div>
            <ul className="device-capabilities-supported-rates-list">
              {supportedSamplerates.map((samplerate) => (
                <li key={samplerate} className="device-capabilities-supported-rates-item">
                  {samplerate} Hz
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="device-capabilities-config-header">Update device config values</div>
        <div className="device-capabilities-config-subtitle">{props.samplerateDescription}</div>
        <div className="device-capabilities-grid">
          <label className="device-capabilities-field">
            <span>channels</span>
            <select
              value={displayedChannels !== null ? displayedChannels.toString() : ""}
              disabled={!rateSupported}
              onChange={(event) => {
                const newChannels = parseInt(event.target.value)
                if (isNaN(newChannels)) return
                const formatsForChannels = normalizeCapabilityFormats(
                  props.backend,
                  getCompatibleFormats(rateCapabilities, newChannels),
                )
                setPendingChannels(newChannels)
                if (
                  pendingFormat !== null &&
                  !formatsForChannels.includes(pendingFormat) &&
                  formatsForChannels.length > 0
                ) {
                  setPendingFormat(formatsForChannels[0])
                }
              }}
            >
              {compatibleChannels.map((value) => (
                <option key={value} value={value.toString()}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="device-capabilities-field">
            <span>sample format</span>
            <select
              value={activeFormat !== null && compatibleFormats.includes(activeFormat) ? activeFormat : ""}
              disabled={!rateSupported}
              onChange={(event) => {
                const newFormat = event.target.value
                if (newFormat === "") {
                  setPendingFormat(null)
                  return
                }
                const channelsForFormat = getCompatibleChannels(rateCapabilities, newFormat)
                setPendingFormat(newFormat)
                if (
                  pendingChannels !== null &&
                  !channelsForFormat.includes(pendingChannels) &&
                  channelsForFormat.length > 0
                ) {
                  setPendingChannels(channelsForFormat[0])
                }
              }}
            >
              {!optionalFormat && <option value="">Select format</option>}
              {compatibleFormatOptions.map((option) => (
                <option key={option.value ?? "default-format"} value={option.value ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="device-capabilities-actions">
          <button
            type="button"
            className="button button-with-text"
            disabled={!canApply}
            onClick={() => {
              if (activeChannels === null) {
                return
              }
              props.onApply(activeChannels, activeFormat)
              props.onClose()
            }}
          >
            Apply and close
          </button>
        </div>
      </div>
    </ReactjsPopup>
  )
}
