import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function parseDate(value: string): Date {
  if (!value) {
    return new Date();
  }

  const parts = value.split("-");

  if (parts.length !== 3) {
    return new Date();
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  const result = new Date(
    year,
    month - 1,
    day
  );

  return Number.isNaN(result.getTime())
    ? new Date()
    : result;
}

function toStorageDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(
    value.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    value.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toDisplayDate(value: string): string {
  if (!value) {
    return "mm/dd/yyyy";
  }

  const date = parseDate(value);

  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

export default function DateField({
  label,
  value,
  onChange,
}: DateFieldProps) {
  const [open, setOpen] =
    useState(false);

  function handleChange(
    event: DateTimePickerEvent,
    selectedDate?: Date
  ) {
    if (Platform.OS === "android") {
      setOpen(false);
    }

    if (
      event.type === "dismissed" ||
      !selectedDate
    ) {
      return;
    }

    onChange(
      toStorageDate(selectedDate)
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          color: "#374151",
        }}
      >
        {label}
      </Text>

      <Pressable
        onPress={() => setOpen(true)}
        style={{
          minHeight: 38,
          minWidth: 130,
          borderWidth: 1,
          borderColor: "#d1d5db",
          borderRadius: 999,
          paddingHorizontal: 12,
          justifyContent: "center",
          backgroundColor: "#ffffff",
        }}
      >
        <Text
          style={{
            color: value
              ? "#111827"
              : "#9ca3af",
            fontSize: 13,
          }}
        >
          {toDisplayDate(value)} 📅
        </Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={parseDate(value)}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}