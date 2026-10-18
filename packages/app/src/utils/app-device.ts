import { Platform } from "react-native";
import { DeviceKind } from "@getpaseo/protocol/connection-history";
import { getIsElectron, isWeb } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";

export function getAppDeviceKind(): DeviceKind {
  if (getIsElectron()) return DeviceKind.Desktop;
  return isWeb ? DeviceKind.Browser : DeviceKind.Mobile;
}

export async function getAppDeviceLabel(): Promise<string> {
  if (getIsElectron()) {
    // COMPAT(desktopDeviceLabel): added in v0.11.0-fork.24; remove after 2027-04-18.
    const computerName = await getDesktopHost()
      ?.invoke?.("desktop_get_computer_name")
      .catch(() => undefined);
    return typeof computerName === "string" ? `Paseo Desktop · ${computerName}` : "Paseo Desktop";
  }
  if (isWeb) {
    let browser = "Web";
    if (/Safari\//.test(navigator.userAgent)) browser = "Safari";
    if (/Chrome\//.test(navigator.userAgent)) browser = "Chrome";
    if (/Firefox\//.test(navigator.userAgent)) browser = "Firefox";
    if (/Edg\//.test(navigator.userAgent)) browser = "Edge";
    return `Browser · ${browser}`;
  }
  if (Platform.OS === "ios") return Platform.isPad ? "iPad" : "iPhone";
  return "Android";
}
