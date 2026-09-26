import fs from 'node:fs';

const luxPath = './apps/web/src/data/luxury-properties.json';
const gpPath = './apps/web/src/data/places-index.json';
const gpHotelsPath = './apps/web/src/data/google-places.json';

if (fs.existsSync(luxPath)) {
  const lux = JSON.parse(fs.readFileSync(luxPath, 'utf8'));
  const properties = lux.properties || [];
  console.log('=== CURATED LUXURY PROPERTIES (Total:', properties.length, ') ===');
  
  const countries = {};
  const regions = {};
  const tiers = {};
  const stars = {};
  const types = {};
  const brands = {};
  const specialBadges = {
    overwater: 0,
    ski_access: 0,
    heritage: 0,
    vineyard: 0,
    wellness: 0,
    business_luxury: 0,
    crypto_payment_verified: 0,
    helipad: 0,
    airport_transfer: 0
  };

  properties.forEach(p => {
    countries[p.country || 'Unknown'] = (countries[p.country || 'Unknown'] || 0) + 1;
    regions[p.region || 'Unknown'] = (regions[p.region || 'Unknown'] || 0) + 1;
    tiers[p.luxuryTier || 'Unspecified'] = (tiers[p.luxuryTier || 'Unspecified'] || 0) + 1;
    stars[p.starRating || 'Unrated'] = (stars[p.starRating || 'Unrated'] || 0) + 1;
    types[p.propertyType || 'Unspecified'] = (types[p.propertyType || 'Unspecified'] || 0) + 1;
    if (p.brand) brands[p.brand] = (brands[p.brand] || 0) + 1;

    if (p.overwater) specialBadges.overwater++;
    if (p.skiAccess) specialBadges.ski_access++;
    if (p.heritageProperty) specialBadges.heritage++;
    if (p.vineyard) specialBadges.vineyard++;
    if (p.wellness) specialBadges.wellness++;
    if (p.businessLuxury) specialBadges.business_luxury++;
    if (p.cryptoPaymentVerified) specialBadges.crypto_payment_verified++;
    if (p.helipad) specialBadges.helipad++;
    if (p.airportTransfer) specialBadges.airport_transfer++;
  });

  console.log('Total Countries in Curated:', Object.keys(countries).length);
  console.log('All Countries breakdown:', JSON.stringify(countries, null, 2));
  console.log('Regions:', JSON.stringify(regions, null, 2));
  console.log('Luxury Tiers:', tiers);
  console.log('Stars:', stars);
  console.log('Property Types:', types);
  console.log('Special Badges:', specialBadges);
  console.log('Top 15 Brands:', Object.entries(brands).sort((a,b)=>b[1]-a[1]).slice(0, 15));
}

if (fs.existsSync(gpPath)) {
  const gp = JSON.parse(fs.readFileSync(gpPath, 'utf8'));
  console.log('\n=== PLACES INDEX STATS ===');
  console.log('Places Index keys:', Object.keys(gp));
  if (gp.stats) console.log('Stats:', gp.stats);
  if (gp.cities) {
    console.log('Cities count:', Object.keys(gp.cities).length);
    console.log('Cities list:', Object.keys(gp.cities));
  }
}

if (fs.existsSync(gpHotelsPath)) {
  const gpHotels = JSON.parse(fs.readFileSync(gpHotelsPath, 'utf8'));
  console.log('\n=== GOOGLE PLACES DATASET STATS ===');
  const count = Array.isArray(gpHotels) ? gpHotels.length : (gpHotels.properties?.length || Object.keys(gpHotels).length);
  console.log('Total entries:', count);
  if (Array.isArray(gpHotels) && gpHotels.length > 0) {
    console.log('Sample item keys:', Object.keys(gpHotels[0]));
    const gpCities = {};
    const gpRatings = {};
    gpHotels.forEach(h => {
      const city = h.city || (h.addressComponents && h.addressComponents.city) || 'Unknown';
      gpCities[city] = (gpCities[city] || 0) + 1;
      const r = Math.floor(h.rating || 0);
      gpRatings[r] = (gpRatings[r] || 0) + 1;
    });
    console.log('Top 20 Cities in Google Places:', Object.entries(gpCities).sort((a,b)=>b[1]-a[1]).slice(0, 20));
    console.log('Ratings breakdown:', gpRatings);
  }
}
