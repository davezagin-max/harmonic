/**
 * The bundled sample crate: 80 invented house tracks. Every title and artist
 * here is made up for this project. It is stored as CSV text on purpose, so the
 * sample goes through the same importer as a visitor's own file.
 */
import { importCrate } from "./import";
import type { Track } from "./types";

export const SAMPLE_CRATE_NAME = "Sample crate";

export const SAMPLE_CRATE_CSV = `\
Title,Artist,BPM,Key,Energy,Genre,Time
Salt Flat Sunrise,Low Tide Committee,117,10A,3,Organic House,6:57
Chairlift Chords,Halcyon Depot,120,6B,4,Deep House,7:17
Little Cottonwood Low End,Motel Orbit,120,10B,3,Deep House,5:44
Tailgate Theory,Petra Lumen,123,8A,6,House,6:28
Corduroy Morning,Static Heirloom,116,10B,3,Organic House,5:59
Powder Day Protocol,Sundial Mechanics,124,8B,6,Progressive House,5:44
Slickrock Shuffle,Vera Quill,128,8B,8,Tech House,6:30
Bonneville Bassline,Orchard Static,127,7A,7,Tech House,6:25
Last Chair Lullaby,Glasshouse Union,102,2A,3,Downtempo,7:48
Red Rock Rhodes,Soft Hardware Co.,120,12A,4,Deep House,6:21
Wasatch After Hours,Orchard Static,122,12A,6,Melodic House,6:46
Parking Lot Prophet,Wren Castellan,125,8A,7,House,6:56
Hi-Hat Hairpin,Arlo Tindall,124,8B,6,Tech House,5:20
Singletrack Mind,The Velvet Abacus,126,6A,8,Progressive House,7:20
Velvet Switchback,Corduroy Satellite,120,11A,4,Melodic House,6:40
Trailhead Disco,Copper Canyon Disco Unit,121,10A,6,Disco House,5:05
Canyon Echo Unit,Tuesday Pressure,122,8B,6,Melodic House,6:24
Apres Arithmetic,Ninefold Arcade,119,5A,5,Disco House,5:37
Gondola Gospel,Second Chairlift,124,11A,7,House,6:25
Fourth Quarter Filter,Mina Solvang,126,7B,8,Peak-Time House,7:02
Dust and Sidechain,Arlo Tindall,125,6A,6,Tech House,6:46
Lake Effect Lounge,Vera Quill,121,7A,5,Deep House,6:16
Inversion Layer Cake,Juno Halvard,119,6B,3,Deep House,7:37
Kickoff at Dusk,Idle Sprocket,126,6A,8,House,6:44
Granite Groove Works,Dune Protocol,126,10A,7,Tech House,5:37
Aspen Glow (Night Version),Zephyr & Ohm,122,9B,5,Melodic House,6:56
Low Battery Sunrise,Kilo Vantage,116,9A,3,Organic House,6:54
Rooftop Antenna,Dune Protocol,122,7B,5,House,6:31
Warm the Room Slowly,Zephyr & Ohm,123,2B,6,Deep House,6:24
Open Fader Policy,Lowlight Ferry,124,12B,7,House,7:40
Sixteen Bars to Sugarhouse,Mina Solvang,126,12A,8,House,6:52
Neon Trail Map,Static Heirloom,126,8A,8,Progressive House,7:09
Quiet Storm Drain,Basement Botanist,121,3A,4,Deep House,6:16
Borrowed Subwoofer,Orchard Static,128,1B,8,Tech House,7:16
Midnight Ski Shuttle,Night Bus Etiquette,122,8A,5,Melodic House,7:39
Loose Gravel Logic,Analog Picnic,129,9A,8,Tech House,6:24
The Long Blend Home,Analog Picnic,126,5A,8,Progressive House,6:33
Grill Smoke Reverb,Rooftop Algebra,121,9A,6,Disco House,6:11
Bluebird Signal,Idle Sprocket,124,4A,6,Progressive House,6:54
Elevation Gain Stage,Tessa Marrow,130,8A,10,Peak-Time House,6:38
Fog on the Benches,Petra Lumen,121,2B,5,Organic House,6:42
Copper Wire Sunset,The Velvet Abacus,121,7B,4,Melodic House,7:48
Tap the Keg Drum,Kilo Vantage,124,9A,7,Afro House,7:04
Avalanche Control Room,Plaid Engine,130,6A,10,Peak-Time House,7:38
Foothill Frequency,Lowlight Ferry,122,12A,6,Afro House,6:28
Three Deck Tango,Halcyon Depot,128,9B,9,Tech House,6:51
Sagebrush Stabs,Sundial Mechanics,122,12A,5,House,6:15
Cooler Full of Claps,Rooftop Algebra,123,8A,7,Disco House,6:33
Desert Varnish Dub,Analog Picnic,123,12A,6,Deep House,5:57
Uphill Both Ways,Marlo Venn,126,9A,8,Progressive House,6:12
Night Ride Lights,Corduroy Satellite,124,11A,7,Melodic House,7:01
Halftime Hot Dog,Saltwater Ledger,119,5A,6,Disco House,5:24
Mineral Basin Maths,Night Bus Etiquette,124,5B,7,Afro House,6:21
Pink Sky Pressure,Plaid Engine,123,5B,7,Progressive House,7:02
Crosswind Clav,Margo Sable,124,7B,7,Disco House,6:30
Folding Chair Anthem,Sundial Mechanics,127,2B,8,Peak-Time House,6:09
Slow Thaw Serenade,Glasshouse Union,103,4A,2,Downtempo,6:17
Berm Shot,Static Heirloom,128,9A,8,Tech House,5:12
"First Tracks, No Friends",Ninefold Arcade,124,12B,7,House,5:14
Second Wind Shuffle,Motel Orbit,120,11A,5,Afro House,7:24
Overtime Organ,Margo Sable,125,2B,8,House,7:38
Kitchen Sink Acid,Tessa Marrow,127,12A,7,Tech House,6:46
Paper Wristband,Saltwater Ledger,126,11B,7,House,6:02
Stadium Lights Low,Kessa Lune,125,12B,6,Melodic House,5:05
Snowmelt Strings,Odd Harbor,116,3B,3,Organic House,5:54
Garage Door Half Open,Rooftop Algebra,121,9B,5,Deep House,6:55
Back Bowl Bounce,Kilo Vantage,128,9A,8,Tech House,6:16
Thermal Layer Dub,Juno Halvard,119,9A,3,Deep House,6:30
Ridge Line Radio,Odd Harbor,122,6A,7,Progressive House,6:50
Sunday Shakeout,Low Tide Committee,122,8B,6,Disco House,7:32
Empty Lot Encore,Soft Hardware Co.,130,10A,10,Peak-Time House,7:08
Moonlit Moguls,Soft Hardware Co.,124,9A,7,Melodic House,6:45
Tram Dock Tempo,Glasshouse Union,123,11A,7,Afro House,6:47
Amber Hour Piano,Basement Botanist,124,10A,7,House,6:01
Float Valve Funk,Copper Canyon Disco Unit,119,9A,5,Disco House,6:51
Switchback Soul,Tessa Marrow,119,1B,3,Deep House,7:49
Team Colors at Midnight,Brassica Sound System,126,2A,8,Peak-Time House,5:35
Daybreak Derailleur,Basement Botanist,119,6A,4,Organic House,7:23
"One More Lap, Then Home",Night Bus Etiquette,124,5A,7,Progressive House,5:18
"Lights Out, Liberty Park",Wren Castellan,123,2A,6,Melodic House,6:12
`;

function load(): Track[] {
  const result = importCrate(SAMPLE_CRATE_CSV);
  if (!result.ok) throw new Error(`Sample crate failed to import: ${result.error}`);
  return result.tracks;
}

/** The sample crate, parsed once by the same importer a visitor's file goes through. */
export const SAMPLE_TRACKS: readonly Track[] = load();
