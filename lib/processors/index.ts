export { process as processGmail } from "@/lib/processors/gmail";
export { process as processCalendar } from "@/lib/processors/calendar";
export { process as processWhisper } from "@/lib/processors/whisper";
export { process as processReminder } from "@/lib/processors/reminder";

export type { GmailPayload, ProcessedGmail } from "@/lib/processors/gmail";
export type { CalendarPayload, ProcessedCalendar } from "@/lib/processors/calendar";
export type { WhisperPayload, ProcessedWhisper } from "@/lib/processors/whisper";
export type { ReminderPayload, ProcessedReminder } from "@/lib/processors/reminder";
