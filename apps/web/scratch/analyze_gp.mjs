import fs from 'node:fs';

const gpHotelsPath = './apps/web/src/data/google-places.json';

if (fs.existsSync(gpHotelsPath)) {
  const gpData = JSON.parse(fs.readFileSync(gpHotelsPath, 'utf8'));
  const properties = gpData.properties || [];
  console.log('=== GOOGLE PLACES DATASET (Total:', properties.length, ') ===');
  console.log('Attribution:', gpData.attribution);
  console.log('ExpiresAt:', gpData.expiresAt);
  
  if (properties.length > 0) {
    const sample = properties[0];
    console.log('\nSample item keys:', Object.keys(sample));
    console.log('Sample item:', JSON.stringify(sample, null, 2));

    const countries = {};
    const cities = {};
    const starRatings = {};
    const luxuryTiers = {};
    const priceLevels = {};
    let withRating = 0;
    let withPhotos = 0;

    properties.forEach(h => {
      if (h.rating) withRating++;
      if (h.photos && h.photos.length > 0) withPhotos++;
      if (h.priceLevel !== undefined) priceLevels[h.priceLevel] = (priceLevels[h.priceLevel] || 0) + 1;
      if (h.stars !== undefined) starRatings[h.stars] = (starRatings[h.stars] || 0) + 1;
      if (h.luxuryTier !== undefined) luxuryTiers[h.luxuryTier] = (luxuryTiers[h.luxuryTier] || 0) + 1;

      const c = h.country || 'Unknown';
      countries[c] = (countries[c] || 0) + 1;

      const city = h.city || 'Unknown';
      cities[city] = (cities[city] || 0) + 1;
    });

    console.log('\nTotal unique countries:', Object.keys(countries).length);
    console.log('Top 30 Countries in Google Places:', Object.entries(countries).sort((a,b)=>b[1]-a[1]).slice(0, 30));
    console.log('\nTotal unique cities:', Object.keys(cities).length);
    console.log('Top 30 Cities in Google Places:', Object.entries(cities).sort((a,b)=>b[1]-a[1]).slice(0, 30));
    console.log('\nStar ratings breakdown:', starRatings);
    console.log('Luxury tiers breakdown:', luxuryTiers);
    console.log('Price Levels:', priceLevels);
    console.log('With rating:', withRating, 'With photos:', withPhotos);
  }
}
