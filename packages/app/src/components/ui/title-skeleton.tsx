import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export function TitleSkeleton({ testID }: { testID?: string }) {
  return <View style={styles.placeholder} testID={testID} />;
}

const styles = StyleSheet.create((theme) => ({
  placeholder: {
    width: 96,
    maxWidth: "100%",
    flexShrink: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.9,
  },
}));
