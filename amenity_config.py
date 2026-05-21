"""
Amenity vocabulary and exclusion list.

Amenity groups are now generated dynamically by Gemini per location type.
The DEFAULT_GROUPS dict is only used as a fallback (e.g. when no AI search
has happened and the user is in OSM-ID mode).
"""

EXCLUDE = {
    # Transportation & parking
    "parking", "parking_entrance", "parking_space", "motorcycle_parking",
    "bicycle_parking", "bus_station", "car_rental", "taxi", "fuel",
    "charging_station", "bicycle_repair_station", "boat_storage",
    "storage_rental", "sanitary_dump_station", "weighbridge",
    "vehicle_inspection", "car", "car_parts", "car_repair", "motorcycle_repair",
    # Waste
    "recycling", "waste_basket", "waste_disposal", "waste_basket;recycling",
    # Street furniture
    "bench", "fountain", "drinking_water", "shower", "toilets", "vending_machine",
    "shelter", "lounger", "bbq", "binoculars", "fireplace", "kneipp_water_cure",
    "watering_place", "lavoir", "dressing_room", "dog_poop_bags", "parcel_locker",
    "public_bookcase",
    # Public admin
    "post_box", "post_office", "police", "fire_station", "courthouse", "townhall",
    "telephone", "telecommunication", "letter_box",
    # Misc
    "bts", "vacant", "hunting_stand", "animal_shelter", "grave_yard", "monastery",
    "pet_grooming", "pet", "funeral_directors", "animal_boarding",
    "brothel", "cannabis", "tattoo",
    "atm", "ticket", "money_lender", "marketplace",
}

# Complete OSM amenity/shop vocabulary we benchmark.
# This is the universe of types the AI must assign to its dynamic groups.
AMENITY_VOCABULARY = {
    # Dining
    "restaurant", "restaurant;bar", "cafe", "coffee", "fast_food", "biergarten", "ice_cream",
    # Nightlife
    "bar", "pub", "nightclub", "casino",
    # Food retail
    "supermarket", "convenience", "bakery", "butcher", "cheese", "deli", "pastry",
    "chocolate", "health_food", "alcohol", "general", "confectionery", "wine", "farm",
    # Sport & ski
    "sports", "outdoor", "ski", "ski_rental", "ski_school", "avalanche_transceiver",
    "snow_park", "bicycle_rental", "water_sports", "boat_rental",
    "fitness_equipment", "lift_tickets", "bicycle",
    # Fashion & beauty
    "clothes", "shoes", "fashion_accessories", "leather", "tailor",
    "cosmetics", "perfumery", "beauty", "hairdresser", "optician",
    # Health & medical
    "pharmacy", "clinic", "doctors", "hospital", "dentist", "medical_supply",
    "hearing_aids", "chemist", "veterinary", "massage", "public_bath",
    # Gifts & speciality
    "gift", "jewelry", "second_hand", "variety_store", "craft", "toys",
    "florist", "stationery", "books", "newsagent", "kiosk", "photo", "tobacco",
    # Home & electronics
    "furniture", "houseware", "interior_decoration", "hardware", "doityourself",
    "electrical", "garden_centre", "paint", "kitchen", "wholesale",
    "department_store", "mall", "electronics", "computer", "mobile_phone",
    "hifi", "camera", "bed", "studio",
    # Culture & community
    "bank", "cinema", "travel_agency", "dry_cleaning", "laundry", "theatre",
    "locksmith", "arts_centre", "art", "music_school", "conference_centre",
    "library", "place_of_worship", "school", "kindergarten", "childcare",
    "community_centre", "social_facility", "clubhouse", "driving_school",
}

# Fallback groups (used only when no AI search has happened — e.g. user
# enters OSM IDs directly without first asking the AI to define a schema).
DEFAULT_GROUPS = [
    {"name": "Dining",             "color": "#E69F00",
     "items": ["restaurant", "restaurant;bar", "cafe", "coffee", "fast_food", "biergarten", "ice_cream"]},
    {"name": "Nightlife",          "color": "#D55E00",
     "items": ["bar", "pub", "nightclub", "casino"]},
    {"name": "Food Retail",        "color": "#56B4E9",
     "items": ["supermarket", "convenience", "bakery", "butcher", "cheese", "deli", "pastry",
               "chocolate", "health_food", "alcohol", "general", "confectionery", "wine", "farm"]},
    {"name": "Sport & Ski",        "color": "#009E73",
     "items": ["sports", "outdoor", "ski", "ski_rental", "ski_school", "avalanche_transceiver",
               "snow_park", "bicycle_rental", "water_sports", "boat_rental",
               "fitness_equipment", "lift_tickets", "bicycle"]},
    {"name": "Fashion & Beauty",   "color": "#CC79A7",
     "items": ["clothes", "shoes", "fashion_accessories", "leather", "tailor",
               "cosmetics", "perfumery", "beauty", "hairdresser", "optician"]},
    {"name": "Health & Medical",   "color": "#0072B2",
     "items": ["pharmacy", "clinic", "doctors", "hospital", "dentist", "medical_supply",
               "hearing_aids", "chemist", "veterinary", "massage", "public_bath"]},
    {"name": "Gifts & Speciality", "color": "#F0E442",
     "items": ["gift", "jewelry", "second_hand", "variety_store", "craft", "toys",
               "florist", "stationery", "books", "newsagent", "kiosk", "photo", "tobacco"]},
    {"name": "Home & Electronics", "color": "#999999",
     "items": ["furniture", "houseware", "interior_decoration", "hardware", "doityourself",
               "electrical", "garden_centre", "paint", "kitchen", "wholesale",
               "department_store", "mall", "electronics", "computer", "mobile_phone",
               "hifi", "camera", "bed", "studio"]},
    {"name": "Culture & Community", "color": "#44AA99",
     "items": ["bank", "cinema", "travel_agency", "dry_cleaning", "laundry", "theatre",
               "locksmith", "arts_centre", "art", "music_school", "conference_centre",
               "library", "place_of_worship", "school", "kindergarten", "childcare",
               "community_centre", "social_facility", "clubhouse", "driving_school"]},
]
