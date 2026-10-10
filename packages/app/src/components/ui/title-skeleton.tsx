import { View, type ViewProps, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export function TitleSkeleton({
  testID,
  width = 96,
}: Pick<ViewProps, "testID"> & Pick<ViewStyle, "width">) {
  return <View style={styles.placeholder(width)} testID={testID} />;
}

const styles = StyleSheet.create((theme) => ({
  placeholder: (width: ViewStyle["width"]) => ({
    width,
    maxWidth: "100%",
    flexShrink: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.9,
  }),
}));
