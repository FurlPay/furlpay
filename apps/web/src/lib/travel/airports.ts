// Static airport directory — offline fallback for the Duffel Places
// suggestions API and display names for demo fares. Codes mirror
// AIRPORT_COORDS in data.ts.

export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  country: string;
}

export const AIRPORTS: AirportInfo[] = [
  { iata: "LHR", name: "Heathrow", city: "London", country: "United Kingdom" },
  { iata: "LGW", name: "Gatwick", city: "London", country: "United Kingdom" },
  { iata: "JFK", name: "John F. Kennedy Intl", city: "New York", country: "United States" },
  { iata: "EWR", name: "Newark Liberty Intl", city: "New York", country: "United States" },
  { iata: "LAX", name: "Los Angeles Intl", city: "Los Angeles", country: "United States" },
  { iata: "SFO", name: "San Francisco Intl", city: "San Francisco", country: "United States" },
  { iata: "ORD", name: "O'Hare Intl", city: "Chicago", country: "United States" },
  { iata: "MIA", name: "Miami Intl", city: "Miami", country: "United States" },
  { iata: "CDG", name: "Charles de Gaulle", city: "Paris", country: "France" },
  { iata: "AMS", name: "Schiphol", city: "Amsterdam", country: "Netherlands" },
  { iata: "FRA", name: "Frankfurt Main", city: "Frankfurt", country: "Germany" },
  { iata: "MAD", name: "Barajas", city: "Madrid", country: "Spain" },
  { iata: "BCN", name: "El Prat", city: "Barcelona", country: "Spain" },
  { iata: "FCO", name: "Fiumicino", city: "Rome", country: "Italy" },
  { iata: "LIS", name: "Humberto Delgado", city: "Lisbon", country: "Portugal" },
  { iata: "ZRH", name: "Zurich Airport", city: "Zurich", country: "Switzerland" },
  { iata: "IST", name: "Istanbul Airport", city: "Istanbul", country: "Türkiye" },
  { iata: "DXB", name: "Dubai Intl", city: "Dubai", country: "United Arab Emirates" },
  { iata: "DOH", name: "Hamad Intl", city: "Doha", country: "Qatar" },
  { iata: "DEL", name: "Indira Gandhi Intl", city: "New Delhi", country: "India" },
  { iata: "BOM", name: "Chhatrapati Shivaji Intl", city: "Mumbai", country: "India" },
  { iata: "BLR", name: "Kempegowda Intl", city: "Bengaluru", country: "India" },
  { iata: "COK", name: "Cochin Intl", city: "Kochi", country: "India" },
  { iata: "SIN", name: "Changi", city: "Singapore", country: "Singapore" },
  { iata: "BKK", name: "Suvarnabhumi", city: "Bangkok", country: "Thailand" },
  { iata: "HKG", name: "Hong Kong Intl", city: "Hong Kong", country: "Hong Kong" },
  { iata: "NRT", name: "Narita Intl", city: "Tokyo", country: "Japan" },
  { iata: "HND", name: "Haneda", city: "Tokyo", country: "Japan" },
  { iata: "ICN", name: "Incheon Intl", city: "Seoul", country: "South Korea" },
  { iata: "SYD", name: "Kingsford Smith", city: "Sydney", country: "Australia" },
  { iata: "MEL", name: "Tullamarine", city: "Melbourne", country: "Australia" },
  { iata: "DPS", name: "Ngurah Rai Intl", city: "Denpasar (Bali)", country: "Indonesia" },
  { iata: "GRU", name: "Guarulhos Intl", city: "São Paulo", country: "Brazil" },
  { iata: "MEX", name: "Benito Juárez Intl", city: "Mexico City", country: "Mexico" },
  { iata: "YYZ", name: "Pearson Intl", city: "Toronto", country: "Canada" },
  { iata: "CAI", name: "Cairo Intl", city: "Cairo", country: "Egypt" },
  { iata: "JNB", name: "O.R. Tambo Intl", city: "Johannesburg", country: "South Africa" },
  { iata: "SJO", name: "Juan Santamaría Intl", city: "San José", country: "Costa Rica" },
];

export function searchAirports(query: string, limit = 8): AirportInfo[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return AIRPORTS.filter(
    (a) =>
      a.iata.toLowerCase().startsWith(q) ||
      a.city.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.country.toLowerCase().includes(q),
  ).slice(0, limit);
}
