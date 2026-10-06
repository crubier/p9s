// Who the mock users are, from their number alone, so that anyone can guess an account to sign in with:
// user0001@example.test to user3000@example.test, all with the same password.
//
// Users are members of Globex, of Initech, or of both. In each organization, members are numbered from 0 in the
// order of their user numbers, and that number decides what they are:
// - the first 5 are admins, the very first one created the organization
// - every 25th, from the 25th, is a guest: in no team, they see what everyone sees, and a few folders and
//   documents shared with them
// - the others are in the department `number % departments`, and the first of each department in every 20 is its lead,
//   with full access to the department's space

export const MOCK_PASSWORD = "password1234";
export const DEFAULT_MOCK_USERS = 3000;
export const MOCK_DOMAIN = "example.test";
// Documents in each organization for each of its members, unless `bun run db:seed --documents-per-member` says otherwise
export const DOCUMENTS_PER_MEMBER = 55;

export const mockEmail = (n: number) => `user${String(n).padStart(4, "0")}@${MOCK_DOMAIN}`;

const FIRST_NAMES = [
  "Ada", "Alan", "Amara", "Ana", "Arjun", "Ava", "Ben", "Bianca", "Carlos", "Chen", "Chloe", "Dan", "Diego", "Elena", "Emeka", "Emma",
  "Farah", "Felix", "Grace", "Hana", "Hugo", "Ines", "Isaac", "Jade", "Jamal", "Jonas", "Julia", "Kai", "Kenji", "Lara", "Leo", "Lina",
  "Lucas", "Maya", "Mei", "Mila", "Nadia", "Nico", "Noah", "Nora", "Omar", "Oscar", "Paula", "Priya", "Quinn", "Rafael", "Rosa", "Ruth",
  "Sami", "Sara", "Sofia", "Tariq", "Theo", "Uma", "Victor", "Wen", "Yara", "Yusuf", "Zoe", "Zora",
];
const LAST_NAMES = [
  "Abe", "Adams", "Alvarez", "Bauer", "Becker", "Bianchi", "Brown", "Castro", "Chen", "Costa", "Dubois", "Eze", "Fischer", "Garcia", "Gupta",
  "Haddad", "Hansen", "Hughes", "Ito", "Jansen", "Kaur", "Kim", "Kowalski", "Larsen", "Lee", "Lopez", "Martin", "Moreau", "Muller", "Nakamura",
  "Nguyen", "Novak", "Okafor", "Olsen", "Park", "Patel", "Perez", "Petrov", "Rossi", "Santos", "Sato", "Schmidt", "Silva", "Singh", "Smith",
  "Sousa", "Suzuki", "Tanaka", "Taylor", "Torres", "Vargas", "Wagner", "Walker", "Wang", "Weber", "Wilson", "Wong", "Yilmaz", "Zhang", "Ziegler",
];

// Distinct for the first 3600 users
export const mockName = (n: number) => `${FIRST_NAMES[n % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(n / FIRST_NAMES.length) % LAST_NAMES.length]}`;

export interface MockOrganization {
  name: string;
  // Its members are the users numbered from `first` to `last`
  first: number;
  last: number;
  departments: string[];
  squads: string[];
}

export const mockOrganizations = (users: number): MockOrganization[] => [
  {
    name: "Globex",
    first: 1,
    last: Math.round(users * 0.8),
    departments: ["Engineering", "Product", "Design", "Sales", "Marketing", "Customer Success", "Finance", "People", "Legal", "Operations"],
    squads: ["Atlas", "Beacon", "Comet", "Delta", "Ember", "Falcon", "Granite", "Harbor", "Iris", "Juniper", "Kestrel", "Lumen"],
  },
  {
    name: "Initech",
    first: Math.round(users * 0.7) + 1,
    last: users,
    departments: ["Engineering", "Sales", "Support", "Finance", "Operations"],
    squads: ["TPS reports", "Y2K", "Flair", "Swingline", "Penthouse"],
  },
];

export interface MockMember {
  n: number;
  index: number;
  admin: boolean;
  guest: boolean;
  department: string | undefined;
  lead: boolean;
}

export const mockMember = (org: MockOrganization, n: number): MockMember => {
  const index = n - org.first;
  const count = org.departments.length;
  const guest = index % 25 === 24;
  return {
    n,
    index,
    admin: index < 5,
    guest,
    department: guest ? undefined : org.departments[index % count],
    lead: !guest && index % (count * 20) < count,
  };
};

export const describeMockMember = (member: MockMember) =>
  [member.admin && "Admin", member.department && `${member.department}${member.lead ? " lead" : ""}`, member.guest && "In no team, a few shares"]
    .filter(Boolean)
    .join(", ");

// A few accounts of each kind, to show on the sign-in page
export const mockExamples = (users: number) =>
  mockOrganizations(users).map((org) => {
    const count = org.departments.length;
    const numbers = [org.first, org.first + count * 20 + 1, org.first + count + 2, org.first + 24];
    return {
      name: org.name,
      first: org.first,
      last: org.last,
      documents: (org.last - org.first + 1) * DOCUMENTS_PER_MEMBER,
      accounts: numbers.filter((n) => n <= org.last).map((n) => ({ name: mockName(n), email: mockEmail(n), who: describeMockMember(mockMember(org, n)) })),
    };
  });
