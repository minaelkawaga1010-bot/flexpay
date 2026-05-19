import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

export function relativeTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday';
  return formatDistanceToNow(date, { addSuffix: true });
}

export function formatDay(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return format(date, 'd MMM yyyy');
}
