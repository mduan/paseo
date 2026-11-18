import { Platform } from "react-native";
import { getIsElectron, getIsElectronMac } from "@/constants/platform";
import type { ShortcutOs } from "@/utils/format-shortcut";
import { isNative } from "@/constants/platform";
import { isMacUserAgent } from "@/utils/mac-user-agent";

export function getShortcutOs(): ShortcutOs {
  if (isNative) {
    return Platform.OS === "ios" ? "mac" : "non-mac";
  }
  if (getIsElectron()) return getIsElectronMac() ? "mac" : "non-mac";
  return isMacUserAgent() ? "mac" : "non-mac";
}
