/**
 * Centralized, production-grade Attendance working hours helper.
 * 
 * Rules:
 * Monday to Friday required hours: 8 hr 30 min (510 min)
 * Monday to Friday full-day minimum (after 20-min grace): 8 hr 10 min (490 min)
 * Monday to Friday half-day minimum (after 10-min grace): 4 hr 5 min (245 min)
 * 
 * Saturday required hours: 7 hr (420 min)
 * Saturday full-day minimum (after 20-min grace): 6 hr 40 min (400 min)
 * Saturday half-day minimum (after 10-min grace): 3 hr 20 min (200 min)
 */

export const evaluateWorkingMinutes = (date, totalMinutes) => {
  const d = new Date(date);
  // Get day of week in UTC to match midnight UTC dates stored in Mongoose
  const dayOfWeek = d.getUTCDay();

  const isSaturday = (dayOfWeek === 6);
  const requiredFullMinutes = isSaturday ? 420 : 510;
  const fullGrace = 20;
  const minFullMinutes = requiredFullMinutes - fullGrace;

  const requiredHalfMinutes = requiredFullMinutes / 2;
  const halfGrace = 10;
  const minHalfMinutes = requiredHalfMinutes - halfGrace;

  let isFullDay = false;
  let isHalfDay = false;
  let isAbsent = false;
  let label = 'Absent';

  if (totalMinutes >= minFullMinutes) {
    isFullDay = true;
    label = 'Full Day';
  } else if (totalMinutes >= minHalfMinutes) {
    isHalfDay = true;
    label = 'Half Day';
  } else {
    isAbsent = true;
    label = 'Absent';
  }

  return {
    isFullDay,
    isHalfDay,
    isAbsent,
    requiredFullMinutes,
    minFullMinutes,
    requiredHalfMinutes,
    minHalfMinutes,
    label
  };
};
