/**
 * Curated global travel destinations for lodging discovery.
 *
 * WHY A CURATED LIST AND NOT "EVERY CITY OVER 500K"
 * ================================================
 * A population list is the wrong shape for this problem. Shenzhen has 17m
 * people and modest tourist lodging; Santorini has 15k and enormous lodging.
 * What matters is hotel inventory and travel demand, so this is chosen for
 * that and each entry carries the radius its inventory actually occupies.
 *
 * `radiusKm` is the half-width of the area worth searching, NOT the city
 * limits. Manhattan's hotels sit inside ~8km; greater Tokyo's spread over
 * ~30km; the Maldives is an archipelago where lodging is scattered across
 * ~60km of atolls with open sea between. One global radius would either
 * miss most of Tokyo or burn hundreds of empty ocean tiles around Malé.
 *
 * `priority` 1 = crawl first (dense inventory, high demand), 3 = crawl last.
 * `--limit N` takes the N highest-priority destinations, so a bounded run is
 * a useful subset rather than an alphabetical accident.
 *
 * Coordinates are city/destination centres in WGS84. They are geography, not
 * Places content, and are ours to hold indefinitely.
 */

/** @typedef {{name:string,country:string,region:string,lat:number,lng:number,radiusKm:number,priority:1|2|3}} Destination */

/** @type {Destination[]} */
export const DESTINATIONS = [
  // ---- Middle East -------------------------------------------------------
  { name: "Dubai", country: "AE", region: "Middle East", lat: 25.2048, lng: 55.2708, radiusKm: 30, priority: 1 },
  { name: "Abu Dhabi", country: "AE", region: "Middle East", lat: 24.4539, lng: 54.3773, radiusKm: 22, priority: 1 },
  { name: "Doha", country: "QA", region: "Middle East", lat: 25.2854, lng: 51.5310, radiusKm: 18, priority: 1 },
  { name: "Riyadh", country: "SA", region: "Middle East", lat: 24.7136, lng: 46.6753, radiusKm: 22, priority: 2 },
  { name: "Jeddah", country: "SA", region: "Middle East", lat: 21.4858, lng: 39.1925, radiusKm: 20, priority: 2 },
  { name: "Muscat", country: "OM", region: "Middle East", lat: 23.5880, lng: 58.3829, radiusKm: 20, priority: 2 },
  { name: "Amman", country: "JO", region: "Middle East", lat: 31.9454, lng: 35.9284, radiusKm: 15, priority: 3 },
  { name: "Tel Aviv", country: "IL", region: "Middle East", lat: 32.0853, lng: 34.7818, radiusKm: 14, priority: 2 },

  // ---- East Asia ---------------------------------------------------------
  { name: "Tokyo", country: "JP", region: "East Asia", lat: 35.6762, lng: 139.6503, radiusKm: 30, priority: 1 },
  { name: "Kyoto", country: "JP", region: "East Asia", lat: 35.0116, lng: 135.7681, radiusKm: 14, priority: 1 },
  { name: "Osaka", country: "JP", region: "East Asia", lat: 34.6937, lng: 135.5023, radiusKm: 18, priority: 1 },
  { name: "Sapporo", country: "JP", region: "East Asia", lat: 43.0618, lng: 141.3545, radiusKm: 14, priority: 3 },
  { name: "Fukuoka", country: "JP", region: "East Asia", lat: 33.5904, lng: 130.4017, radiusKm: 14, priority: 3 },
  { name: "Seoul", country: "KR", region: "East Asia", lat: 37.5665, lng: 126.9780, radiusKm: 25, priority: 1 },
  { name: "Busan", country: "KR", region: "East Asia", lat: 35.1796, lng: 129.0756, radiusKm: 18, priority: 2 },
  { name: "Beijing", country: "CN", region: "East Asia", lat: 39.9042, lng: 116.4074, radiusKm: 25, priority: 1 },
  { name: "Shanghai", country: "CN", region: "East Asia", lat: 31.2304, lng: 121.4737, radiusKm: 28, priority: 1 },
  { name: "Shenzhen", country: "CN", region: "East Asia", lat: 22.5431, lng: 114.0579, radiusKm: 22, priority: 2 },
  { name: "Guangzhou", country: "CN", region: "East Asia", lat: 23.1291, lng: 113.2644, radiusKm: 22, priority: 2 },
  { name: "Hong Kong", country: "HK", region: "East Asia", lat: 22.3193, lng: 114.1694, radiusKm: 18, priority: 1 },
  { name: "Macau", country: "MO", region: "East Asia", lat: 22.1987, lng: 113.5439, radiusKm: 10, priority: 2 },
  { name: "Taipei", country: "TW", region: "East Asia", lat: 25.0330, lng: 121.5654, radiusKm: 18, priority: 2 },

  // ---- Southeast Asia ----------------------------------------------------
  { name: "Singapore", country: "SG", region: "Southeast Asia", lat: 1.3521, lng: 103.8198, radiusKm: 18, priority: 1 },
  { name: "Bangkok", country: "TH", region: "Southeast Asia", lat: 13.7563, lng: 100.5018, radiusKm: 25, priority: 1 },
  { name: "Chiang Mai", country: "TH", region: "Southeast Asia", lat: 18.7883, lng: 98.9853, radiusKm: 14, priority: 2 },
  { name: "Phuket", country: "TH", region: "Southeast Asia", lat: 7.8804, lng: 98.3923, radiusKm: 28, priority: 1 },
  { name: "Koh Samui", country: "TH", region: "Southeast Asia", lat: 9.5120, lng: 100.0136, radiusKm: 16, priority: 2 },
  { name: "Bali", country: "ID", region: "Southeast Asia", lat: -8.4095, lng: 115.1889, radiusKm: 35, priority: 1 },
  { name: "Jakarta", country: "ID", region: "Southeast Asia", lat: -6.2088, lng: 106.8456, radiusKm: 22, priority: 2 },
  { name: "Kuala Lumpur", country: "MY", region: "Southeast Asia", lat: 3.1390, lng: 101.6869, radiusKm: 20, priority: 1 },
  { name: "Penang", country: "MY", region: "Southeast Asia", lat: 5.4164, lng: 100.3327, radiusKm: 16, priority: 3 },
  { name: "Manila", country: "PH", region: "Southeast Asia", lat: 14.5995, lng: 120.9842, radiusKm: 22, priority: 2 },
  { name: "Cebu", country: "PH", region: "Southeast Asia", lat: 10.3157, lng: 123.8854, radiusKm: 18, priority: 3 },
  { name: "Boracay", country: "PH", region: "Southeast Asia", lat: 11.9674, lng: 121.9248, radiusKm: 8, priority: 3 },
  { name: "Hanoi", country: "VN", region: "Southeast Asia", lat: 21.0278, lng: 105.8342, radiusKm: 16, priority: 2 },
  { name: "Ho Chi Minh City", country: "VN", region: "Southeast Asia", lat: 10.8231, lng: 106.6297, radiusKm: 20, priority: 2 },
  { name: "Da Nang", country: "VN", region: "Southeast Asia", lat: 16.0544, lng: 108.2022, radiusKm: 16, priority: 3 },
  { name: "Nha Trang", country: "VN", region: "Southeast Asia", lat: 12.2388, lng: 109.1967, radiusKm: 14, priority: 3 },
  { name: "Siem Reap", country: "KH", region: "Southeast Asia", lat: 13.3671, lng: 103.8448, radiusKm: 12, priority: 3 },
  { name: "Phnom Penh", country: "KH", region: "Southeast Asia", lat: 11.5564, lng: 104.9282, radiusKm: 12, priority: 3 },

  // ---- South Asia --------------------------------------------------------
  { name: "Mumbai", country: "IN", region: "South Asia", lat: 19.0760, lng: 72.8777, radiusKm: 25, priority: 1 },
  { name: "New Delhi", country: "IN", region: "South Asia", lat: 28.6139, lng: 77.2090, radiusKm: 28, priority: 1 },
  { name: "Bengaluru", country: "IN", region: "South Asia", lat: 12.9716, lng: 77.5946, radiusKm: 22, priority: 2 },
  { name: "Hyderabad", country: "IN", region: "South Asia", lat: 17.3850, lng: 78.4867, radiusKm: 20, priority: 2 },
  { name: "Chennai", country: "IN", region: "South Asia", lat: 13.0827, lng: 80.2707, radiusKm: 20, priority: 2 },
  { name: "Kolkata", country: "IN", region: "South Asia", lat: 22.5726, lng: 88.3639, radiusKm: 20, priority: 3 },
  { name: "Goa", country: "IN", region: "South Asia", lat: 15.2993, lng: 74.1240, radiusKm: 30, priority: 1 },
  { name: "Jaipur", country: "IN", region: "South Asia", lat: 26.9124, lng: 75.7873, radiusKm: 16, priority: 2 },
  { name: "Udaipur", country: "IN", region: "South Asia", lat: 24.5854, lng: 73.7125, radiusKm: 12, priority: 2 },
  { name: "Kochi", country: "IN", region: "South Asia", lat: 9.9312, lng: 76.2673, radiusKm: 16, priority: 3 },
  { name: "Pune", country: "IN", region: "South Asia", lat: 18.5204, lng: 73.8567, radiusKm: 16, priority: 3 },
  { name: "Ahmedabad", country: "IN", region: "South Asia", lat: 23.0225, lng: 72.5714, radiusKm: 16, priority: 3 },
  { name: "Maldives", country: "MV", region: "South Asia", lat: 3.2028, lng: 73.2207, radiusKm: 60, priority: 1 },
  { name: "Colombo", country: "LK", region: "South Asia", lat: 6.9271, lng: 79.8612, radiusKm: 16, priority: 3 },
  { name: "Kathmandu", country: "NP", region: "South Asia", lat: 27.7172, lng: 85.3240, radiusKm: 12, priority: 3 },

  // ---- Western Europe ----------------------------------------------------
  { name: "London", country: "GB", region: "Europe", lat: 51.5074, lng: -0.1278, radiusKm: 28, priority: 1 },
  { name: "Edinburgh", country: "GB", region: "Europe", lat: 55.9533, lng: -3.1883, radiusKm: 12, priority: 2 },
  { name: "Dublin", country: "IE", region: "Europe", lat: 53.3498, lng: -6.2603, radiusKm: 14, priority: 2 },
  { name: "Paris", country: "FR", region: "Europe", lat: 48.8566, lng: 2.3522, radiusKm: 22, priority: 1 },
  { name: "Nice", country: "FR", region: "Europe", lat: 43.7102, lng: 7.2620, radiusKm: 16, priority: 2 },
  { name: "Amsterdam", country: "NL", region: "Europe", lat: 52.3676, lng: 4.9041, radiusKm: 16, priority: 1 },
  { name: "Brussels", country: "BE", region: "Europe", lat: 50.8503, lng: 4.3517, radiusKm: 14, priority: 3 },
  { name: "Berlin", country: "DE", region: "Europe", lat: 52.5200, lng: 13.4050, radiusKm: 22, priority: 1 },
  { name: "Munich", country: "DE", region: "Europe", lat: 48.1351, lng: 11.5820, radiusKm: 16, priority: 2 },
  { name: "Frankfurt", country: "DE", region: "Europe", lat: 50.1109, lng: 8.6821, radiusKm: 14, priority: 2 },
  { name: "Zurich", country: "CH", region: "Europe", lat: 47.3769, lng: 8.5417, radiusKm: 14, priority: 1 },
  { name: "Geneva", country: "CH", region: "Europe", lat: 46.2044, lng: 6.1432, radiusKm: 12, priority: 2 },
  { name: "Vienna", country: "AT", region: "Europe", lat: 48.2082, lng: 16.3738, radiusKm: 16, priority: 1 },
  { name: "Prague", country: "CZ", region: "Europe", lat: 50.0755, lng: 14.4378, radiusKm: 14, priority: 1 },
  { name: "Budapest", country: "HU", region: "Europe", lat: 47.4979, lng: 19.0402, radiusKm: 14, priority: 2 },

  // ---- Southern Europe ---------------------------------------------------
  { name: "Rome", country: "IT", region: "Europe", lat: 41.9028, lng: 12.4964, radiusKm: 20, priority: 1 },
  { name: "Milan", country: "IT", region: "Europe", lat: 45.4642, lng: 9.1900, radiusKm: 16, priority: 1 },
  { name: "Florence", country: "IT", region: "Europe", lat: 43.7696, lng: 11.2558, radiusKm: 12, priority: 1 },
  { name: "Venice", country: "IT", region: "Europe", lat: 45.4408, lng: 12.3155, radiusKm: 12, priority: 1 },
  { name: "Naples", country: "IT", region: "Europe", lat: 40.8518, lng: 14.2681, radiusKm: 16, priority: 2 },
  { name: "Barcelona", country: "ES", region: "Europe", lat: 41.3851, lng: 2.1734, radiusKm: 18, priority: 1 },
  { name: "Madrid", country: "ES", region: "Europe", lat: 40.4168, lng: -3.7038, radiusKm: 20, priority: 1 },
  { name: "Seville", country: "ES", region: "Europe", lat: 37.3891, lng: -5.9845, radiusKm: 12, priority: 2 },
  { name: "Palma de Mallorca", country: "ES", region: "Europe", lat: 39.5696, lng: 2.6502, radiusKm: 20, priority: 2 },
  { name: "Lisbon", country: "PT", region: "Europe", lat: 38.7223, lng: -9.1393, radiusKm: 16, priority: 1 },
  { name: "Porto", country: "PT", region: "Europe", lat: 41.1579, lng: -8.6291, radiusKm: 12, priority: 2 },
  { name: "Athens", country: "GR", region: "Europe", lat: 37.9838, lng: 23.7275, radiusKm: 18, priority: 1 },
  { name: "Santorini", country: "GR", region: "Europe", lat: 36.3932, lng: 25.4615, radiusKm: 12, priority: 1 },
  { name: "Mykonos", country: "GR", region: "Europe", lat: 37.4467, lng: 25.3289, radiusKm: 10, priority: 2 },
  { name: "Istanbul", country: "TR", region: "Europe", lat: 41.0082, lng: 28.9784, radiusKm: 25, priority: 1 },
  { name: "Antalya", country: "TR", region: "Europe", lat: 36.8969, lng: 30.7133, radiusKm: 22, priority: 2 },
  { name: "Dubrovnik", country: "HR", region: "Europe", lat: 42.6507, lng: 18.0944, radiusKm: 10, priority: 2 },
  { name: "Split", country: "HR", region: "Europe", lat: 43.5081, lng: 16.4402, radiusKm: 12, priority: 3 },

  // ---- Northern Europe ---------------------------------------------------
  { name: "Copenhagen", country: "DK", region: "Europe", lat: 55.6761, lng: 12.5683, radiusKm: 14, priority: 2 },
  { name: "Stockholm", country: "SE", region: "Europe", lat: 59.3293, lng: 18.0686, radiusKm: 16, priority: 2 },
  { name: "Oslo", country: "NO", region: "Europe", lat: 59.9139, lng: 10.7522, radiusKm: 14, priority: 3 },
  { name: "Helsinki", country: "FI", region: "Europe", lat: 60.1699, lng: 24.9384, radiusKm: 14, priority: 3 },
  { name: "Reykjavik", country: "IS", region: "Europe", lat: 64.1466, lng: -21.9426, radiusKm: 12, priority: 2 },

  // ---- North America -----------------------------------------------------
  { name: "New York", country: "US", region: "North America", lat: 40.7128, lng: -74.0060, radiusKm: 22, priority: 1 },
  { name: "Los Angeles", country: "US", region: "North America", lat: 34.0522, lng: -118.2437, radiusKm: 32, priority: 1 },
  { name: "San Francisco", country: "US", region: "North America", lat: 37.7749, lng: -122.4194, radiusKm: 16, priority: 1 },
  { name: "Las Vegas", country: "US", region: "North America", lat: 36.1699, lng: -115.1398, radiusKm: 18, priority: 1 },
  { name: "Miami", country: "US", region: "North America", lat: 25.7617, lng: -80.1918, radiusKm: 22, priority: 1 },
  { name: "Orlando", country: "US", region: "North America", lat: 28.5383, lng: -81.3792, radiusKm: 25, priority: 1 },
  { name: "Chicago", country: "US", region: "North America", lat: 41.8781, lng: -87.6298, radiusKm: 20, priority: 2 },
  { name: "Boston", country: "US", region: "North America", lat: 42.3601, lng: -71.0589, radiusKm: 16, priority: 2 },
  { name: "Seattle", country: "US", region: "North America", lat: 47.6062, lng: -122.3321, radiusKm: 16, priority: 2 },
  { name: "Washington DC", country: "US", region: "North America", lat: 38.9072, lng: -77.0369, radiusKm: 16, priority: 2 },
  { name: "San Diego", country: "US", region: "North America", lat: 32.7157, lng: -117.1611, radiusKm: 20, priority: 2 },
  { name: "Austin", country: "US", region: "North America", lat: 30.2672, lng: -97.7431, radiusKm: 16, priority: 3 },
  { name: "Dallas", country: "US", region: "North America", lat: 32.7767, lng: -96.7970, radiusKm: 20, priority: 3 },
  { name: "Houston", country: "US", region: "North America", lat: 29.7604, lng: -95.3698, radiusKm: 20, priority: 3 },
  { name: "New Orleans", country: "US", region: "North America", lat: 29.9511, lng: -90.0715, radiusKm: 14, priority: 3 },
  { name: "Honolulu", country: "US", region: "North America", lat: 21.3069, lng: -157.8583, radiusKm: 18, priority: 1 },
  { name: "Toronto", country: "CA", region: "North America", lat: 43.6532, lng: -79.3832, radiusKm: 20, priority: 2 },
  { name: "Vancouver", country: "CA", region: "North America", lat: 49.2827, lng: -123.1207, radiusKm: 16, priority: 2 },
  { name: "Montreal", country: "CA", region: "North America", lat: 45.5017, lng: -73.5673, radiusKm: 16, priority: 2 },
  { name: "Calgary", country: "CA", region: "North America", lat: 51.0447, lng: -114.0719, radiusKm: 14, priority: 3 },
  { name: "Mexico City", country: "MX", region: "North America", lat: 19.4326, lng: -99.1332, radiusKm: 25, priority: 1 },
  { name: "Cancun", country: "MX", region: "North America", lat: 21.1619, lng: -86.8515, radiusKm: 22, priority: 1 },
  { name: "Tulum", country: "MX", region: "North America", lat: 20.2114, lng: -87.4654, radiusKm: 14, priority: 2 },
  { name: "Playa del Carmen", country: "MX", region: "North America", lat: 20.6296, lng: -87.0739, radiusKm: 14, priority: 2 },
  { name: "Los Cabos", country: "MX", region: "North America", lat: 22.8905, lng: -109.9167, radiusKm: 20, priority: 2 },

  // ---- Caribbean ---------------------------------------------------------
  { name: "Punta Cana", country: "DO", region: "Caribbean", lat: 18.5820, lng: -68.4055, radiusKm: 20, priority: 2 },
  { name: "Nassau", country: "BS", region: "Caribbean", lat: 25.0443, lng: -77.3504, radiusKm: 14, priority: 2 },
  { name: "Montego Bay", country: "JM", region: "Caribbean", lat: 18.4762, lng: -77.8939, radiusKm: 14, priority: 3 },
  { name: "San Juan", country: "PR", region: "Caribbean", lat: 18.4655, lng: -66.1057, radiusKm: 14, priority: 3 },
  { name: "Aruba", country: "AW", region: "Caribbean", lat: 12.5211, lng: -69.9683, radiusKm: 12, priority: 3 },
  { name: "Barbados", country: "BB", region: "Caribbean", lat: 13.1939, lng: -59.5432, radiusKm: 14, priority: 3 },

  // ---- South America -----------------------------------------------------
  { name: "Rio de Janeiro", country: "BR", region: "South America", lat: -22.9068, lng: -43.1729, radiusKm: 22, priority: 1 },
  { name: "Sao Paulo", country: "BR", region: "South America", lat: -23.5505, lng: -46.6333, radiusKm: 25, priority: 2 },
  { name: "Buenos Aires", country: "AR", region: "South America", lat: -34.6037, lng: -58.3816, radiusKm: 20, priority: 2 },
  { name: "Santiago", country: "CL", region: "South America", lat: -33.4489, lng: -70.6693, radiusKm: 18, priority: 2 },
  { name: "Lima", country: "PE", region: "South America", lat: -12.0464, lng: -77.0428, radiusKm: 20, priority: 2 },
  { name: "Cusco", country: "PE", region: "South America", lat: -13.5319, lng: -71.9675, radiusKm: 12, priority: 2 },
  { name: "Bogota", country: "CO", region: "South America", lat: 4.7110, lng: -74.0721, radiusKm: 18, priority: 3 },
  { name: "Medellin", country: "CO", region: "South America", lat: 6.2476, lng: -75.5658, radiusKm: 14, priority: 3 },
  { name: "Cartagena", country: "CO", region: "South America", lat: 10.3910, lng: -75.4794, radiusKm: 12, priority: 2 },
  { name: "Quito", country: "EC", region: "South America", lat: -0.1807, lng: -78.4678, radiusKm: 14, priority: 3 },

  // ---- Africa ------------------------------------------------------------
  { name: "Cairo", country: "EG", region: "Africa", lat: 30.0444, lng: 31.2357, radiusKm: 25, priority: 1 },
  { name: "Alexandria", country: "EG", region: "Africa", lat: 31.2001, lng: 29.9187, radiusKm: 16, priority: 3 },
  { name: "Sharm El Sheikh", country: "EG", region: "Africa", lat: 27.9158, lng: 34.3300, radiusKm: 16, priority: 2 },
  { name: "Marrakesh", country: "MA", region: "Africa", lat: 31.6295, lng: -7.9811, radiusKm: 14, priority: 1 },
  { name: "Casablanca", country: "MA", region: "Africa", lat: 33.5731, lng: -7.5898, radiusKm: 16, priority: 3 },
  { name: "Cape Town", country: "ZA", region: "Africa", lat: -33.9249, lng: 18.4241, radiusKm: 22, priority: 1 },
  { name: "Johannesburg", country: "ZA", region: "Africa", lat: -26.2041, lng: 28.0473, radiusKm: 22, priority: 2 },
  { name: "Durban", country: "ZA", region: "Africa", lat: -29.8587, lng: 31.0218, radiusKm: 16, priority: 3 },
  { name: "Nairobi", country: "KE", region: "Africa", lat: -1.2921, lng: 36.8219, radiusKm: 18, priority: 2 },
  { name: "Zanzibar", country: "TZ", region: "Africa", lat: -6.1659, lng: 39.2026, radiusKm: 20, priority: 2 },
  { name: "Mauritius", country: "MU", region: "Africa", lat: -20.3484, lng: 57.5522, radiusKm: 25, priority: 1 },
  { name: "Seychelles", country: "SC", region: "Africa", lat: -4.6796, lng: 55.4920, radiusKm: 20, priority: 1 },
  { name: "Accra", country: "GH", region: "Africa", lat: 5.6037, lng: -0.1870, radiusKm: 14, priority: 3 },
  { name: "Lagos", country: "NG", region: "Africa", lat: 6.5244, lng: 3.3792, radiusKm: 20, priority: 3 },

  // ---- Oceania -----------------------------------------------------------
  { name: "Sydney", country: "AU", region: "Oceania", lat: -33.8688, lng: 151.2093, radiusKm: 25, priority: 1 },
  { name: "Melbourne", country: "AU", region: "Oceania", lat: -37.8136, lng: 144.9631, radiusKm: 22, priority: 1 },
  { name: "Brisbane", country: "AU", region: "Oceania", lat: -27.4698, lng: 153.0251, radiusKm: 18, priority: 2 },
  { name: "Gold Coast", country: "AU", region: "Oceania", lat: -28.0167, lng: 153.4000, radiusKm: 18, priority: 2 },
  { name: "Perth", country: "AU", region: "Oceania", lat: -31.9505, lng: 115.8605, radiusKm: 18, priority: 3 },
  { name: "Cairns", country: "AU", region: "Oceania", lat: -16.9186, lng: 145.7781, radiusKm: 14, priority: 3 },
  { name: "Auckland", country: "NZ", region: "Oceania", lat: -36.8485, lng: 174.7633, radiusKm: 18, priority: 2 },
  { name: "Queenstown", country: "NZ", region: "Oceania", lat: -45.0312, lng: 168.6626, radiusKm: 14, priority: 2 },
  { name: "Wellington", country: "NZ", region: "Oceania", lat: -41.2866, lng: 174.7756, radiusKm: 12, priority: 3 },
  { name: "Fiji", country: "FJ", region: "Oceania", lat: -17.7134, lng: 178.0650, radiusKm: 35, priority: 2 },
  { name: "Bora Bora", country: "PF", region: "Oceania", lat: -16.5004, lng: -151.7415, radiusKm: 10, priority: 2 },
  { name: "Tahiti", country: "PF", region: "Oceania", lat: -17.6509, lng: -149.4260, radiusKm: 18, priority: 3 },
];

/** Destinations sorted for crawling: highest priority first, then by name. */
export function orderedDestinations() {
  return [...DESTINATIONS].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name)
  );
}

export function destinationStats() {
  const byRegion = {};
  const countries = new Set();
  for (const d of DESTINATIONS) {
    byRegion[d.region] = (byRegion[d.region] ?? 0) + 1;
    countries.add(d.country);
  }
  return { total: DESTINATIONS.length, countries: countries.size, byRegion };
}
