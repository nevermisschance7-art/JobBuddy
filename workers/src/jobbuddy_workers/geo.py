"""Location strings to ISO country codes and remote regions.

Jobs come from everywhere, written every way: "Remote - EMEA", "New York, NY",
"Ludwigsburg, BW, Germany", "Singapore, Singapore", "Anywhere". This turns them into
country codes (for filtering) and remote regions (for remote jobs limited to an area).
"""

from __future__ import annotations

import re
import unicodedata

# ISO 3166-1 alpha-2 -> English name.
COUNTRIES: dict[str, str] = {
    "AD": "Andorra", "AE": "United Arab Emirates", "AF": "Afghanistan", "AG": "Antigua and Barbuda",
    "AL": "Albania", "AM": "Armenia", "AO": "Angola", "AR": "Argentina", "AT": "Austria",
    "AU": "Australia", "AZ": "Azerbaijan", "BA": "Bosnia and Herzegovina", "BB": "Barbados",
    "BD": "Bangladesh", "BE": "Belgium", "BF": "Burkina Faso", "BG": "Bulgaria", "BH": "Bahrain",
    "BI": "Burundi", "BJ": "Benin", "BN": "Brunei", "BO": "Bolivia", "BR": "Brazil",
    "BS": "Bahamas", "BT": "Bhutan", "BW": "Botswana", "BY": "Belarus", "BZ": "Belize",
    "CA": "Canada", "CD": "Democratic Republic of the Congo", "CF": "Central African Republic",
    "CG": "Republic of the Congo", "CH": "Switzerland", "CI": "Ivory Coast", "CL": "Chile",
    "CM": "Cameroon", "CN": "China", "CO": "Colombia", "CR": "Costa Rica", "CU": "Cuba",
    "CV": "Cape Verde", "CY": "Cyprus", "CZ": "Czechia", "DE": "Germany", "DJ": "Djibouti",
    "DK": "Denmark", "DM": "Dominica", "DO": "Dominican Republic", "DZ": "Algeria",
    "EC": "Ecuador", "EE": "Estonia", "EG": "Egypt", "ER": "Eritrea", "ES": "Spain",
    "ET": "Ethiopia", "FI": "Finland", "FJ": "Fiji", "FR": "France", "GA": "Gabon",
    "GB": "United Kingdom", "GD": "Grenada", "GE": "Georgia", "GH": "Ghana", "GM": "Gambia",
    "GN": "Guinea", "GQ": "Equatorial Guinea", "GR": "Greece", "GT": "Guatemala",
    "GW": "Guinea-Bissau", "GY": "Guyana", "HK": "Hong Kong", "HN": "Honduras", "HR": "Croatia",
    "HT": "Haiti", "HU": "Hungary", "ID": "Indonesia", "IE": "Ireland", "IL": "Israel",
    "IN": "India", "IQ": "Iraq", "IR": "Iran", "IS": "Iceland", "IT": "Italy", "JM": "Jamaica",
    "JO": "Jordan", "JP": "Japan", "KE": "Kenya", "KG": "Kyrgyzstan", "KH": "Cambodia",
    "KR": "South Korea", "KW": "Kuwait", "KZ": "Kazakhstan", "LA": "Laos", "LB": "Lebanon",
    "LI": "Liechtenstein", "LK": "Sri Lanka", "LR": "Liberia", "LS": "Lesotho", "LT": "Lithuania",
    "LU": "Luxembourg", "LV": "Latvia", "LY": "Libya", "MA": "Morocco", "MC": "Monaco",
    "MD": "Moldova", "ME": "Montenegro", "MG": "Madagascar", "MK": "North Macedonia",
    "ML": "Mali", "MM": "Myanmar", "MN": "Mongolia", "MO": "Macau", "MR": "Mauritania",
    "MT": "Malta", "MU": "Mauritius", "MV": "Maldives", "MW": "Malawi", "MX": "Mexico",
    "MY": "Malaysia", "MZ": "Mozambique", "NA": "Namibia", "NE": "Niger", "NG": "Nigeria",
    "NI": "Nicaragua", "NL": "Netherlands", "NO": "Norway", "NP": "Nepal", "NZ": "New Zealand",
    "OM": "Oman", "PA": "Panama", "PE": "Peru", "PG": "Papua New Guinea", "PH": "Philippines",
    "PK": "Pakistan", "PL": "Poland", "PR": "Puerto Rico", "PS": "Palestine", "PT": "Portugal",
    "PY": "Paraguay", "QA": "Qatar", "RO": "Romania", "RS": "Serbia", "RU": "Russia",
    "RW": "Rwanda", "SA": "Saudi Arabia", "SC": "Seychelles", "SD": "Sudan", "SE": "Sweden",
    "SG": "Singapore", "SI": "Slovenia", "SK": "Slovakia", "SL": "Sierra Leone",
    "SM": "San Marino", "SN": "Senegal", "SO": "Somalia", "SR": "Suriname", "SS": "South Sudan",
    "SV": "El Salvador", "SY": "Syria", "TG": "Togo", "TH": "Thailand", "TJ": "Tajikistan",
    "TN": "Tunisia", "TR": "Turkey", "TT": "Trinidad and Tobago", "TW": "Taiwan",
    "TZ": "Tanzania", "UA": "Ukraine", "UG": "Uganda", "US": "United States", "UY": "Uruguay",
    "UZ": "Uzbekistan", "VE": "Venezuela", "VN": "Vietnam", "XK": "Kosovo", "YE": "Yemen",
    "ZA": "South Africa", "ZM": "Zambia", "ZW": "Zimbabwe",
}  # fmt: skip

ALIASES: dict[str, str] = {
    "usa": "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US", "america": "US",
    "uk": "GB", "u.k.": "GB", "great britain": "GB", "britain": "GB", "england": "GB",
    "scotland": "GB", "wales": "GB", "northern ireland": "GB",
    "uae": "AE", "emirates": "AE", "dubai": "AE", "abu dhabi": "AE",
    "deutschland": "DE", "germany (de)": "DE", "españa": "ES", "espana": "ES",
    "the netherlands": "NL", "holland": "NL", "nederland": "NL", "czech republic": "CZ",
    "korea": "KR", "republic of korea": "KR", "türkiye": "TR", "turkiye": "TR",
    "viet nam": "VN", "russian federation": "RU", "schweiz": "CH", "suisse": "CH",
    "österreich": "AT", "osterreich": "AT", "italia": "IT", "polska": "PL", "brasil": "BR",
    "méxico": "MX", "mexico city": "MX", "cdmx": "MX", "côte d'ivoire": "CI",
    "hong kong sar": "HK", "macedonia": "MK", "the bahamas": "BS",
}  # fmt: skip

US_STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california",
    "CO": "colorado", "CT": "connecticut", "DE": "delaware", "FL": "florida", "GA": "georgia",
    "HI": "hawaii", "ID": "idaho", "IL": "illinois", "IN": "indiana", "IA": "iowa",
    "KS": "kansas", "KY": "kentucky", "LA": "louisiana", "ME": "maine", "MD": "maryland",
    "MA": "massachusetts", "MI": "michigan", "MN": "minnesota", "MS": "mississippi",
    "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada", "NH": "new hampshire",
    "NJ": "new jersey", "NM": "new mexico", "NY": "new york", "NC": "north carolina",
    "ND": "north dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon", "PA": "pennsylvania",
    "RI": "rhode island", "SC": "south carolina", "SD": "south dakota", "TN": "tennessee",
    "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington",
    "WV": "west virginia", "WI": "wisconsin", "WY": "wyoming", "DC": "district of columbia",
}  # fmt: skip

CA_PROVINCES = {
    "AB": "alberta", "BC": "british columbia", "MB": "manitoba", "NB": "new brunswick",
    "NL": "newfoundland and labrador", "NS": "nova scotia", "ON": "ontario",
    "PE": "prince edward island", "QC": "quebec", "SK": "saskatchewan",
}  # fmt: skip

# Cities that often appear without a country. Lower-case, ASCII-folded.
CITIES: dict[str, str] = {
    "san francisco": "US", "sf": "US", "new york": "US", "nyc": "US", "seattle": "US",
    "austin": "US", "boston": "US", "chicago": "US", "los angeles": "US", "denver": "US",
    "atlanta": "US", "miami": "US", "san jose": "US", "palo alto": "US", "mountain view": "US",
    "sunnyvale": "US", "menlo park": "US", "redwood city": "US", "san mateo": "US",
    "san diego": "US", "portland": "US", "washington dc": "US", "philadelphia": "US",
    "pittsburgh": "US", "salt lake city": "US", "dallas": "US", "houston": "US",
    "raleigh": "US", "nashville": "US", "minneapolis": "US", "detroit": "US", "phoenix": "US",
    "bay area": "US", "silicon valley": "US", "toronto": "CA", "vancouver": "CA",
    "montreal": "CA", "ottawa": "CA", "calgary": "CA", "waterloo": "CA", "london": "GB",
    "manchester": "GB", "edinburgh": "GB", "cambridge": "GB", "oxford": "GB", "bristol": "GB",
    "leeds": "GB", "glasgow": "GB", "belfast": "GB", "birmingham": "GB", "dublin": "IE",
    "cork": "IE", "berlin": "DE", "munich": "DE", "munchen": "DE", "hamburg": "DE",
    "frankfurt": "DE", "cologne": "DE", "koln": "DE", "stuttgart": "DE", "dusseldorf": "DE",
    "paris": "FR", "lyon": "FR", "amsterdam": "NL", "rotterdam": "NL", "utrecht": "NL",
    "eindhoven": "NL", "the hague": "NL", "brussels": "BE", "antwerp": "BE", "ghent": "BE",
    "zurich": "CH", "geneva": "CH", "lausanne": "CH", "basel": "CH", "vienna": "AT",
    "wien": "AT", "madrid": "ES", "barcelona": "ES", "valencia": "ES", "lisbon": "PT",
    "porto": "PT", "milan": "IT", "milano": "IT", "rome": "IT", "turin": "IT",
    "stockholm": "SE", "gothenburg": "SE", "malmo": "SE", "copenhagen": "DK", "aarhus": "DK",
    "oslo": "NO", "helsinki": "FI", "tallinn": "EE", "riga": "LV", "vilnius": "LT",
    "warsaw": "PL", "krakow": "PL", "wroclaw": "PL", "gdansk": "PL", "poznan": "PL",
    "prague": "CZ", "brno": "CZ", "budapest": "HU", "bucharest": "RO", "cluj-napoca": "RO",
    "sofia": "BG", "athens": "GR", "belgrade": "RS", "zagreb": "HR", "ljubljana": "SI",
    "kyiv": "UA", "kiev": "UA", "lviv": "UA", "istanbul": "TR", "tel aviv": "IL",
    "bangalore": "IN", "bengaluru": "IN", "hyderabad": "IN", "pune": "IN", "mumbai": "IN",
    "delhi": "IN", "new delhi": "IN", "gurgaon": "IN", "gurugram": "IN", "noida": "IN",
    "chennai": "IN", "kolkata": "IN", "tokyo": "JP", "osaka": "JP", "seoul": "KR",
    "beijing": "CN", "shanghai": "CN", "shenzhen": "CN", "taipei": "TW",
    "kuala lumpur": "MY", "jakarta": "ID", "bangkok": "TH", "manila": "PH",
    "ho chi minh city": "VN", "hanoi": "VN", "sydney": "AU", "melbourne": "AU",
    "brisbane": "AU", "perth": "AU", "auckland": "NZ", "wellington": "NZ",
    "sao paulo": "BR", "rio de janeiro": "BR", "buenos aires": "AR", "bogota": "CO",
    "medellin": "CO", "santiago": "CL", "lima": "PE", "montevideo": "UY",
    "guadalajara": "MX", "monterrey": "MX", "cape town": "ZA", "johannesburg": "ZA",
    "lagos": "NG", "nairobi": "KE", "cairo": "EG", "riyadh": "SA", "doha": "QA",
}  # fmt: skip

# Remote regions. Values are the tags stored in jobs.remote_regions.
REGIONS: dict[str, str] = {
    "worldwide": "WORLDWIDE", "anywhere": "WORLDWIDE", "global": "WORLDWIDE",
    "globally": "WORLDWIDE", "international": "WORLDWIDE", "any location": "WORLDWIDE",
    "work from anywhere": "WORLDWIDE",
    "emea": "EMEA", "europe": "EUROPE", "eu": "EUROPE", "european union": "EUROPE",
    "eea": "EUROPE", "cet": "EUROPE", "cest": "EUROPE",
    "americas": "AMERICAS", "north america": "NORTH_AMERICA", "na": "NORTH_AMERICA",
    "latam": "LATAM", "latin america": "LATAM", "south america": "LATAM",
    "apac": "APAC", "asia": "APAC", "asia pacific": "APAC", "asia-pacific": "APAC",
    "oceania": "APAC", "anz": "APAC", "africa": "AFRICA", "middle east": "MIDDLE_EAST",
    "mena": "MIDDLE_EAST",
}  # fmt: skip

# Which countries each region covers (used by the matcher for remote jobs).
EUROPE = {
    "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME",
    "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "XK",
}  # fmt: skip
NORTH_AMERICA = {"US", "CA", "MX"}
LATAM = {
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "HN", "MX", "NI", "PA", "PE",
    "PR", "PY", "SV", "UY", "VE",
}  # fmt: skip
APAC = {
    "AU", "BD", "BN", "CN", "FJ", "HK", "ID", "IN", "JP", "KH", "KR", "LA", "LK", "MM", "MN",
    "MO", "MY", "NP", "NZ", "PG", "PH", "PK", "SG", "TH", "TW", "VN",
}  # fmt: skip
MIDDLE_EAST = {
    "AE", "BH", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE",
}  # fmt: skip
AFRICA = {
    "AO", "BF", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "DZ", "EG", "ER",
    "ET", "GA", "GH", "GM", "GN", "GQ", "GW", "KE", "LR", "LS", "LY", "MA", "MG", "ML", "MR",
    "MU", "MW", "MZ", "NA", "NE", "NG", "RW", "SC", "SD", "SL", "SN", "SO", "SS", "TG", "TN",
    "TZ", "UG", "ZA", "ZM", "ZW",
}  # fmt: skip
REGION_COUNTRIES: dict[str, set[str]] = {
    "EUROPE": EUROPE,
    "EMEA": EUROPE | MIDDLE_EAST | AFRICA,
    "NORTH_AMERICA": NORTH_AMERICA,
    "AMERICAS": NORTH_AMERICA | LATAM,
    "LATAM": LATAM,
    "APAC": APAC,
    "MIDDLE_EAST": MIDDLE_EAST,
    "AFRICA": AFRICA,
}


def fold(text: str) -> str:
    """Lower-case, strip accents, collapse spaces."""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip().lower()


_NAME_TO_CODE: dict[str, str] = {fold(n): c for c, n in COUNTRIES.items()} | {
    fold(a): c for a, c in ALIASES.items()
}
_STATE_NAMES = {name: "US" for name in US_STATES.values()}
_PROVINCE_NAMES = {name: "CA" for name in CA_PROVINCES.values()}


def country_code(value: str | None) -> str | None:
    """A country name, alias or ISO code (any case) to an ISO code."""
    if not value:
        return None
    v = value.strip()
    if len(v) == 2 and v.upper() in COUNTRIES:
        return v.upper()
    if len(v) == 3 and v.upper() in {"USA", "GBR", "DEU", "FRA", "CAN", "AUS", "IND", "NLD"}:
        return {"USA": "US", "GBR": "GB", "DEU": "DE", "FRA": "FR", "CAN": "CA", "AUS": "AU",
                "IND": "IN", "NLD": "NL"}[v.upper()]  # fmt: skip
    return _NAME_TO_CODE.get(fold(v))


def parse_location(text: str | None) -> tuple[set[str], set[str], bool]:
    """Returns (country codes, remote regions, mentions remote) for one location string."""
    if not text:
        return set(), set(), False
    folded = fold(text)
    is_remote = bool(re.search(r"\bremote\b|\bwfh\b|work from home|telecommute|anywhere", folded))
    countries: set[str] = set()
    regions: set[str] = set()

    parts = [p.strip() for p in re.split(r"[,;/|()\-–]+|\bor\b|\band\b", folded) if p.strip()]
    raw_parts = [p.strip() for p in re.split(r"[,;/|()\-–]+", text) if p.strip()]

    for part in parts:
        part = re.sub(r"^(remote|hybrid|onsite|on-site|in|based in)\s+", "", part).strip()
        if part in REGIONS:
            regions.add(REGIONS[part])
            continue
        code = _NAME_TO_CODE.get(part) or CITIES.get(part)
        if code:
            countries.add(code)
            continue
        if part in _STATE_NAMES:
            countries.add("US")
        elif part in _PROVINCE_NAMES:
            countries.add("CA")

    # "Austin, TX" / "Toronto, ON": two-letter state or province codes after a comma.
    # A two-letter code only counts as a country when it is the last part and nothing else
    # matched ("BW" in "Ludwigsburg, BW, Germany" is a German state, not Botswana).
    for i, raw in enumerate(raw_parts[1:], start=1):
        r = raw.strip()
        if len(r) != 2 or not r.isupper() or countries:
            continue
        if r in US_STATES:
            countries.add("US")
        elif r in CA_PROVINCES:
            countries.add("CA")
        elif r in COUNTRIES and i == len(raw_parts) - 1:
            countries.add(r)

    # Whole-string fallbacks: "Remote US", "US Remote", "Remote (Europe)".
    for name, tag in REGIONS.items():
        # Short names like "eu"/"na" only count as whole parts (handled above).
        if len(name) >= 4 and re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", folded):
            regions.add(tag)
    if not countries:
        for code in re.findall(r"\b([A-Z]{2})\b", text):
            if code in {"US", "UK", "EU"}:
                if code == "EU":
                    regions.add("EUROPE")
                else:
                    countries.add("GB" if code == "UK" else code)

    if (
        is_remote
        and not countries
        and not regions
        and re.search(r"anywhere|worldwide|global", folded)
    ):
        regions.add("WORLDWIDE")
    return countries, regions, is_remote


def parse_locations(texts: list[str | None]) -> tuple[list[str], list[str], bool]:
    """Union over several location strings. Sorted for stable hashes."""
    countries: set[str] = set()
    regions: set[str] = set()
    remote = False
    for t in texts:
        c, r, rem = parse_location(t)
        countries |= c
        regions |= r
        remote = remote or rem
    return sorted(countries), sorted(regions), remote


def region_covers(region: str, country: str) -> bool:
    if region == "WORLDWIDE":
        return True
    return country in REGION_COUNTRIES.get(region, set())
