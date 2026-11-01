/** Ready-made names for the bill form. Suggestions only: anyone can still type their own. */
export const ISSUE_NAMES = [
  "Brake Noise", "Worn Brake Pads", "AC Not Cooling", "Engine Oil Leak", "Coolant Leak", "Battery Weak", "Starting Trouble", "Engine Overheating", "Steering Pulling", "Suspension Noise",
  "Clutch Slipping", "Gear Shift Problem", "Tyre Worn Out", "Puncture", "Wheel Vibration", "Headlight Not Working", "Horn Not Working", "Wiper Not Working", "Electrical Fault", "Dent or Scratch", "Check Engine Light",
];

export const PART_NAMES = [
  "Engine Oil", "Oil Filter", "Air Filter", "Fuel Filter", "Cabin AC Filter", "Spark Plug", "Brake Pads", "Brake Shoes", "Brake Disc", "Brake Fluid",
  "Coolant", "Battery", "Tyre", "Wiper Blades", "Clutch Plate", "Clutch Cable", "Timing Belt", "Fan Belt", "Radiator", "Headlight Bulb",
  "Tail Light Bulb", "Shock Absorber", "Wheel Bearing", "AC Gas", "Horn", "Side Mirror", "Fuse",
];

export const WORK_NAMES = [
  "Car Wash", "Foam Wash", "Interior Cleaning", "Engine Bay Cleaning", "Polishing", "Waxing", "Ceramic Coating", "Oil Change", "General Service", "Full Service",
  "AC Service", "Brake Service", "Wheel Alignment", "Wheel Balancing", "Tyre Rotation", "Puncture Repair", "Battery Check", "Engine Repair", "Clutch Repair",
  "Suspension Repair", "Electrical Repair", "Denting", "Painting", "Scratch Removal", "Labour Charge", "Pickup and Drop",
];

/** Starting prices in rupees. Garages set their own in Settings; these are only a first draft. */
export const DEFAULT_PRICE_LIST = `Car Wash = 300
Foam Wash = 500
Interior Cleaning = 800
Engine Bay Cleaning = 600
Polishing = 1500
Waxing = 1000
Ceramic Coating = 15000
Oil Change = 1500
General Service = 3000
Full Service = 6000
AC Service = 2000
Brake Service = 1500
Wheel Alignment = 800
Wheel Balancing = 500
Tyre Rotation = 300
Puncture Repair = 150
Battery Check = 100
Labour Charge = 500
Pickup and Drop = 300
Engine Oil = 800
Oil Filter = 300
Air Filter = 500
Cabin AC Filter = 600
Spark Plug = 300
Brake Pads = 2000
Brake Fluid = 400
Coolant = 500
Wiper Blades = 600
Headlight Bulb = 400`;

/** Reads "Name = price" lines. Lines that don't parse are skipped rather than guessed at. */
export function parsePriceList(text: string): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^(.+?)\s*=\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (match?.[1].trim()) prices[match[1].trim()] = Number(match[2]);
  }
  return prices;
}
