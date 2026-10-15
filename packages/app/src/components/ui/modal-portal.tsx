import { createPortal } from "react-dom";
import { Modal, StyleSheet, View, type ModalProps } from "react-native";
import { isWeb } from "@/constants/platform";
import { getOverlayRoot } from "@/lib/overlay-root";

type ModalPortalProps = ModalProps & { layer: number; visible: boolean };

export function ModalPortal({ layer, visible, children, ...props }: ModalPortalProps) {
  if (!isWeb)
    return (
      <Modal {...props} visible={visible}>
        {children}
      </Modal>
    );
  if (!visible) return null;

  // React Native Web's Modal focus trap competes with menus in the shared portal.
  return createPortal(
    <View
      role="dialog"
      aria-modal
      style={[styles.overlay, { zIndex: layer }]}
      testID={props.testID}
    >
      {children}
    </View>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, pointerEvents: "auto" },
});
