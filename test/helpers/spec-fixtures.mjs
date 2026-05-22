export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_REFRESH_FAILED',
  'INVALID_INPUT',
  'GROUP_NOT_FOUND',
  'GROUP_ACCESS_DENIED',
  'MEMBER_NOT_FOUND',
  'TRANSACTION_NOT_FOUND',
  'API_REQUEST_FAILED',
  'API_RATE_LIMITED',
  'SERVER_TASK_FAILED',
];

export const successEnvelope = {
  ok: true,
  data: {},
  meta: {
    environment: 'test',
  },
};

export const errorEnvelope = {
  ok: false,
  error: {
    code: 'GROUP_NOT_FOUND',
    message: 'Group g123 was not found',
    details: {},
  },
  meta: {
    environment: 'test',
  },
};

export const authLoginData = {
  uid: 'u1',
  email: 'me@example.com',
  expiresAt: 1777872000000,
};

export const authStatusData = {
  authenticated: true,
  uid: 'u1',
  email: 'me@example.com',
  expiresAt: 1777872000000,
};

export const createGroupInput = {
  name: 'Goa Trip',
  convertedToCurrency: 'INR',
  defaultPermission: 10,
  minimizeDebts: true,
  remindOldDebts: true,
  firstMember: {
    name: 'Anshul',
    active: true,
    defaultWeight: '1',
    photoUrl: null,
    bankAccount: null,
    lightningAddress: null,
  },
};

export const memberInput = {
  name: 'Sid',
  active: true,
  defaultWeight: '1',
  photoUrl: null,
  bankAccount: null,
  lightningAddress: null,
};

export const memberPatchInput = {
  name: 'Siddharth',
  defaultWeight: '1.5',
};

export const setCategoriesInput = {
  categories: {
    '🍽️': 'Food',
    '🚕': 'Transport',
    '☕': 'Coffee',
  },
};

export const groupRecordSample = {
  ownerColor: '#ec1561',
  convertedToCurrency: 'USD',
  inviteLink: 'https://join.settleup.app/abcdefgh',
  inviteLinkHash: 'test',
  inviteLinkActive: true,
  minimizeDebts: true,
  remindOldDebts: true,
  name: 'Dogfood',
  premiumPurchasedBy: 'user_id_1',
  premiumPurchasedUntil: 1457015264428,
  lastChanged: 1457015264428,
  defaultPermission: 10,
};

export const permissionRecordSample = {
  level: 30,
};

export const userRecordSample = {
  currentTabId: 'group_id_1',
  authProvider: 'google',
  email: 'me@destil.cz',
  inviteLinkHash: 'test',
  name: 'David Vavra',
  photoUrl: 'https://lh3.googleusercontent.com/example/photo.jpg',
  superuser: true,
  locale: 'en-us',
};

export const userGroupRecordSample = {
  order: 1,
  color: '#ec1561',
  member: 'member_id_1',
};

export const changeRecordSample = {
  action: 'insert',
  by: 'user_id_1',
  entity: 'expense',
  entityId: 'transaction_id_1',
  entityName: 'Pivo',
  serverTimestamp: 147454656,
};

export const debtsSample = [
  {
    from: 'member_id_1',
    to: 'member_id_2',
    amount: '100.50',
  },
  {
    from: 'member_id_1',
    to: 'member_id_3',
    amount: '100.50',
  },
];

export const serverTaskRequestSample = {
  request: {
    groupId: 'group_id_1',
  },
};

export const weightedMemberRef = {
  memberId: 'm_sid',
  weight: '1',
};

export const transactionItem = {
  amount: '2400',
  forWhom: [
    { memberId: 'm_sid', weight: '1' },
    { memberId: 'm_neha', weight: '1' },
  ],
};

export const expenseInput = {
  type: 'expense',
  purpose: 'Dinner',
  category: '🍽️',
  currencyCode: 'INR',
  dateTime: 1777824000000,
  timezone: '+05:30',
  fixedExchangeRate: false,
  exchangeRates: {},
  receiptUrl: null,
  templateId: null,
  whoPaid: [
    { memberId: 'm_sid', weight: '1' },
  ],
  items: [
    {
      amount: '2400',
      forWhom: [
        { memberId: 'm_sid', weight: '1' },
        { memberId: 'm_neha', weight: '1' },
        { memberId: 'm_rohan', weight: '1' },
      ],
    },
  ],
};

export const transferInput = {
  type: 'transfer',
  purpose: 'Neha settled dinner share',
  category: '💸',
  currencyCode: 'INR',
  dateTime: 1777827600000,
  timezone: '+05:30',
  fixedExchangeRate: false,
  exchangeRates: {},
  receiptUrl: null,
  templateId: null,
  whoPaid: [
    { memberId: 'm_neha', weight: '1' },
  ],
  items: [
    {
      amount: '800',
      forWhom: [
        { memberId: 'm_sid', weight: '1' },
      ],
    },
  ],
};

export const transactionPatchInput = {
  purpose: 'Dinner at Thalassa',
  category: '🍽️',
  items: [
    {
      amount: '2500',
      forWhom: [
        { memberId: 'm_sid', weight: '1' },
        { memberId: 'm_neha', weight: '1' },
        { memberId: 'm_rohan', weight: '1' },
      ],
    },
  ],
};
