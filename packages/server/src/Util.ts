export function isHighTrafficTime(): boolean {
  // More traffic from 4am to 4pm
  const now = new Date();

  // Convert current time to PST (America/Los_Angeles timezone)
  // Using a more compatible approach
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });

  const formattedTime = formatter.format(now);
  const hourPST = parseInt(formattedTime.split(":")[0], 10);

  return hourPST >= 4 && hourPST < 16;
}
