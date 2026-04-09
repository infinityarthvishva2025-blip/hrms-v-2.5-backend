import { config } from '../config/index.js';

// Haversine formula to calculate distance between two GPS coordinates
const toRad = (value) => (value * Math.PI) / 180;

export const distanceInMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const isWithinOffice = (latitude, longitude) => {
  const distance = distanceInMeters(
    config.office.latitude,
    config.office.longitude,
    latitude,
    longitude
  );
  return {
    isValid: distance <= config.office.radiusMeters,
    distance: Math.round(distance),
  };
};
