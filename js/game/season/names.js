// Name and place lists for golfers the career generates (college standouts and journeymen on the
// Korn Ferry Tour) and for the tier-2 event names. Invented combinations, not real people; a generated
// name that matches a real tour golfer in the career is re-drawn (tiers.js).

export const FIRST = [
  "Aaron", "Adam", "Aiden", "Alex", "Andre", "Andrew", "Anton", "Asher", "Austin", "Ben", "Blake", "Brady", "Brendan",
  "Brett", "Bryce", "Caleb", "Cameron", "Carlos", "Carter", "Chase", "Chris", "Cole", "Connor", "Cooper", "Dalton",
  "Daniel", "Dante", "David", "Declan", "Derek", "Diego", "Dylan", "Eli", "Elliot", "Emeka", "Eric", "Ethan", "Evan",
  "Felix", "Finn", "Gabriel", "Garrett", "Gavin", "Grant", "Grayson", "Hamish", "Hayden", "Henrik", "Hiroshi", "Hudson",
  "Hunter", "Ian", "Isaac", "Jack", "Jace", "Jake", "James", "Jared", "Jason", "Javier", "Jesse", "Joaquin", "Joel",
  "Jonah", "Jordan", "Jose", "Josh", "Julian", "Kai", "Keegan", "Kenji", "Kevin", "Kieran", "Kyle", "Landon", "Leo",
  "Liam", "Logan", "Luca", "Lucas", "Luis", "Malik", "Marco", "Mason", "Mateo", "Matt", "Max", "Micah", "Miguel", "Miles",
  "Min-jun", "Nate", "Nico", "Noah", "Nolan", "Oliver", "Omar", "Oscar", "Owen", "Parker", "Patrick", "Paul", "Pedro",
  "Quinn", "Rafael", "Reid", "Rhys", "Riley", "Rowan", "Ryan", "Sam", "Santiago", "Sean", "Seth", "Shane", "Sung-ho",
  "Tanner", "Taro", "Theo", "Thomas", "Tobias", "Trent", "Tristan", "Tyler", "Victor", "Wade", "Wes", "Will", "Wyatt",
  "Xavier", "Yuki", "Zach", "Zane",
];

export const LAST = [
  "Abbott", "Acosta", "Adler", "Alvarez", "Ambrose", "Ashby", "Bader", "Baird", "Barlow", "Becker", "Bell", "Bennett",
  "Bishop", "Blackwood", "Boyd", "Brandt", "Brennan", "Briggs", "Burke", "Calloway", "Carmichael", "Castillo", "Chen",
  "Choi", "Clarke", "Cobb", "Conway", "Cortez", "Crane", "Dalton", "Delgado", "Dempsey", "Donnelly", "Doyle", "Drake",
  "Duarte", "Easton", "Ellison", "Emery", "Ferris", "Fleming", "Ford", "Fowler", "Fraser", "Gallagher", "Garza", "Gentry",
  "Gibbs", "Gordon", "Graves", "Hale", "Halvorsen", "Hammond", "Harper", "Hayes", "Holt", "Hughes", "Ibarra", "Ingram",
  "Jensen", "Kaufman", "Keane", "Keller", "Kendall", "Kirkland", "Kowalski", "Lambert", "Larsen", "Lindqvist", "Lowell",
  "Lucero", "Lynch", "Maddox", "Marsh", "McAllister", "McBride", "McCoy", "Mercer", "Molina", "Monroe", "Moreau", "Nakamura",
  "Nash", "Novak", "Oakley", "Okafor", "Olsen", "Ortega", "Pace", "Park", "Pearce", "Pierce", "Pruitt", "Quinlan", "Ramsey",
  "Reyes", "Rhodes", "Ritter", "Rourke", "Salazar", "Sandoval", "Sato", "Schultz", "Sexton", "Shaw", "Sinclair", "Sloane",
  "Soto", "Stafford", "Strand", "Sutton", "Tanaka", "Thorne", "Tillman", "Townsend", "Vance", "Vargas", "Vaughn", "Voss",
  "Wade", "Walsh", "Warner", "Whitaker", "Winslow", "Wolfe", "Yates", "Yoon", "Zamora",
];

// [country as players.json writes it, weight]: mostly US, as on the real developmental tours
export const COUNTRIES = [
  ["United States", 58], ["England", 5], ["Canada", 5], ["Australia", 5], ["South Africa", 4], ["Korea", 4],
  ["Japan", 3], ["Sweden", 3], ["Scotland", 2], ["Ireland", 2], ["Mexico", 2], ["Argentina", 2], ["Colombia", 1],
  ["Germany", 1], ["Denmark", 1], ["Norway", 1], ["New Zealand", 1],
];

// Korn Ferry Tour event names: "<place> Championship" / "<place> Classic" / "<place> Open"
export const PLACES = [
  "Tidewater", "Blue Ridge", "Lone Star", "Gulf Coast", "Palmetto", "Bluegrass", "Ozark", "High Desert", "Great Lakes",
  "Cascade", "Prairie", "Piedmont", "Sonoran", "Magnolia", "Sawtooth", "Chesapeake", "Red River", "Black Hills",
  "Finger Lakes", "Low Country", "Bayou", "Mesa Verde", "Willamette", "Cumberland", "Shenandoah", "Big Sky", "Catskill",
  "Coral Coast", "Badlands", "Wabash", "Monterey Bay", "Hill Country", "Copper Canyon",
];
export const SUFFIX = ["Championship", "Classic", "Open", "Invitational"];
