// Sendowl Product ID → site shortName
// Le site est déterminé par la colonne "Site" du CSV (code interne Sendowl)
// Ce mapping permet de résoudre les codes internes vers les shortNames du dashboard

export const SENDOWL_SITE_CODE_MAP: Record<string, string> = {
  // Zigzag on Earth (EN)
  'ZZOE': 'ZZ EN',
  // Zigzag Voyages (FR)
  'ZV': 'ZZ FR',
  // Zigzag Reisen (DE)
  'ZR': 'ZZ R',
  // Zigzag Viajes (ES)
  'ZE': 'ZZ ES',
  // Corsica Lovers (multi-langue)
  'CL - EN': 'Corse',
  'CL - FR': 'Corse',
  'CL - DE': 'Corse',
  'CL - IT': 'Corse',
  'CL - ES': 'Corse',
  'CL - NL': 'Corse',
  // Normandie Lovers (multi-langue)
  'NL - FR': 'Normandie',
  'NL - EN': 'Normandie',
  'NL - DE': 'Normandie',
  'NL - ES': 'Normandie',
  'NL - IT': 'Normandie',
  'NL - NL': 'Normandie',
};

// Mapping product ID → site shortName pour les cas où la colonne Site n'est pas disponible
export const SENDOWL_PRODUCT_ID_MAP: Record<string, string> = {
  // ZZOE products
  '78250166': 'ZZ EN',
  '78250169': 'Corse',
  '78250170': 'Corse',
  '78250172': 'Corse',
  '78250174': 'ZZ EN',
  '78250177': 'ZZ EN',
  '78250180': 'ZZ EN',
  '78250184': 'ZZ EN',
  '78250186': 'ZZ EN',
  '78250191': 'ZZ EN',
  '78250193': 'ZZ EN',
  '78250195': 'ZZ EN',
  '78250198': 'ZZ EN',
  '78250200': 'ZZ EN',
  '78250202': 'ZZ EN',
  '78250203': 'ZZ EN',
  '78250207': 'ZZ EN',
  '78250210': 'ZZ EN',
  '78250215': 'ZZ EN',
  // ZV products
  '78250261': 'ZZ FR',
  '78250264': 'Corse',
  '78250266': 'Corse',
  '78250267': 'Corse',
  '78250279': 'ZZ FR',
  '78250283': 'ZZ FR',
  '78250284': 'ZZ FR',
  '78250286': 'ZZ FR',
  '78250287': 'ZZ FR',
  '78250289': 'ZZ FR',
  '78250293': 'ZZ FR',
  '78250296': 'ZZ FR',
  '78250299': 'ZZ FR',
  '78250301': 'ZZ FR',
  '78250302': 'ZZ FR',
  '78250303': 'ZZ FR',
  '78250307': 'ZZ FR',
  // ZR products
  '78250321': 'ZZ R',
  '78250327': 'Corse',
  '78250332': 'ZZ R',
  '78250334': 'ZZ R',
  '78250338': 'ZZ R',
  '78250344': 'ZZ R',
  '78250351': 'ZZ R',
  '78250354': 'ZZ R',
  '78250359': 'ZZ R',
  '78250364': 'ZZ R',
  '78250371': 'ZZ R',
  '78439542': 'ZZ R',
  '78439546': 'ZZ R',
  // Madeira
  '78573308': 'ZZ EN',
  '78576638': 'ZZ FR',
  '78584672': 'ZZ R',
  // Majorque / Baleares
  '78627869': 'ZZ EN',
  '78627870': 'ZZ FR',
  '78630417': 'ZZ R',
  // Normandie
  '78340460': 'Normandie',
  '78340466': 'Normandie',
  '78394966': 'Normandie',
  '78824666': 'Normandie',
  '78824667': 'Normandie',
  '78824669': 'Normandie',
  // Corsica multi-langue
  '78825115': 'Corse',
  '78826052': 'Corse',
  '78840697': 'Corse',
  // ZE products
  '78838876': 'ZZ ES',
  '78838877': 'ZZ ES',
  '78838878': 'ZZ ES',
  '78838879': 'ZZ ES',
  '78838880': 'ZZ ES',
  '78838881': 'ZZ ES',
  '78838882': 'ZZ ES',
};
