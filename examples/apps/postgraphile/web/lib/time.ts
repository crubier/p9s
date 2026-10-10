// Columns are `timestamp`, in UTC, which GraphQL sends without a zone: read them as UTC rather than local time
export const parseTime = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
