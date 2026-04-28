import Anthropic from '@anthropic-ai/sdk';
import { TranscriptSegment, ClinicalEntity } from './types';

/**
 * Extended entity with source tracking for audit trail.
 * Records which transcript segment produced each entity.
 */
export interface TrackedEntity extends ClinicalEntity {
  /** Index of the source TranscriptSegment */
  sourceSegmentIndex: number;
  /** Speaker from the source segment */
  sourceSpeaker: TranscriptSegment['speaker'];
  /** Timestamp range from the source segment */
  sourceTimeRange: { start: number; end: number };
}

/**
 * Structured extraction result returned by EntityExtractor.
 */
export interface ExtractionResult {
  entities: TrackedEntity[];
  /** Whether Claude API was used (true) or regex fallback (false) */
  usedAI: boolean;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

// ── Regex lookup tables ────────────────────────────────────────────────────

/** Common medications with RxNorm CUIs and dose patterns */
const MEDICATION_DB: Array<{
  pattern: RegExp;
  name: string;
  rxNorm?: string;
}> = [
  // Cardiovascular
  { pattern: /\bmetoprolol\b/i, name: 'metoprolol', rxNorm: '6918' },
  { pattern: /\blisinopril\b/i, name: 'lisinopril', rxNorm: '29046' },
  { pattern: /\bamlodipine\b/i, name: 'amlodipine', rxNorm: '17767' },
  { pattern: /\blosartan\b/i, name: 'losartan', rxNorm: '52175' },
  { pattern: /\batenolol\b/i, name: 'atenolol', rxNorm: '1202' },
  { pattern: /\bhydrochlorothiazide\b/i, name: 'hydrochlorothiazide', rxNorm: '5487' },
  { pattern: /\bhctz\b/i, name: 'hydrochlorothiazide', rxNorm: '5487' },
  { pattern: /\bcarvedilol\b/i, name: 'carvedilol', rxNorm: '20352' },
  { pattern: /\bvalsartan\b/i, name: 'valsartan', rxNorm: '69749' },
  { pattern: /\bdiltiazem\b/i, name: 'diltiazem', rxNorm: '3443' },
  { pattern: /\bverapamil\b/i, name: 'verapamil', rxNorm: '11170' },
  { pattern: /\bspironolactone\b/i, name: 'spironolactone', rxNorm: '9997' },
  { pattern: /\bfurosemide\b/i, name: 'furosemide', rxNorm: '4603' },
  { pattern: /\blasix\b/i, name: 'furosemide', rxNorm: '4603' },
  { pattern: /\bdigoxin\b/i, name: 'digoxin', rxNorm: '3407' },
  { pattern: /\bclonidine\b/i, name: 'clonidine', rxNorm: '2599' },
  { pattern: /\bhydralazine\b/i, name: 'hydralazine', rxNorm: '5470' },
  { pattern: /\bpropranolol\b/i, name: 'propranolol', rxNorm: '8787' },
  // Statins / Lipids
  { pattern: /\batorvastatin\b/i, name: 'atorvastatin', rxNorm: '83367' },
  { pattern: /\blipitor\b/i, name: 'atorvastatin', rxNorm: '83367' },
  { pattern: /\brosuvastatin\b/i, name: 'rosuvastatin', rxNorm: '301542' },
  { pattern: /\bcrestor\b/i, name: 'rosuvastatin', rxNorm: '301542' },
  { pattern: /\bsimvastatin\b/i, name: 'simvastatin', rxNorm: '36567' },
  { pattern: /\bpravastatin\b/i, name: 'pravastatin', rxNorm: '42463' },
  // Diabetes
  { pattern: /\bmetformin\b/i, name: 'metformin', rxNorm: '6809' },
  { pattern: /\bglucophage\b/i, name: 'metformin', rxNorm: '6809' },
  { pattern: /\bglipizide\b/i, name: 'glipizide', rxNorm: '4815' },
  { pattern: /\bglyburide\b/i, name: 'glyburide', rxNorm: '4821' },
  { pattern: /\binsulin\b/i, name: 'insulin', rxNorm: '253182' },
  { pattern: /\bempagliflozin\b/i, name: 'empagliflozin', rxNorm: '1545653' },
  { pattern: /\bjardiance\b/i, name: 'empagliflozin', rxNorm: '1545653' },
  { pattern: /\bsemaglutide\b/i, name: 'semaglutide', rxNorm: '1991302' },
  { pattern: /\bozempic\b/i, name: 'semaglutide', rxNorm: '1991302' },
  { pattern: /\bsitagliptin\b/i, name: 'sitagliptin', rxNorm: '593411' },
  { pattern: /\bjanuvia\b/i, name: 'sitagliptin', rxNorm: '593411' },
  { pattern: /\bpioglitazone\b/i, name: 'pioglitazone', rxNorm: '33738' },
  // GI / PPI
  { pattern: /\bomeprazole\b/i, name: 'omeprazole', rxNorm: '7646' },
  { pattern: /\bprilosec\b/i, name: 'omeprazole', rxNorm: '7646' },
  { pattern: /\bpantoprazole\b/i, name: 'pantoprazole', rxNorm: '40790' },
  { pattern: /\besomeprazole\b/i, name: 'esomeprazole', rxNorm: '283742' },
  { pattern: /\bnexium\b/i, name: 'esomeprazole', rxNorm: '283742' },
  { pattern: /\bfamotidine\b/i, name: 'famotidine', rxNorm: '4278' },
  { pattern: /\bpepcid\b/i, name: 'famotidine', rxNorm: '4278' },
  { pattern: /\bondansetron\b/i, name: 'ondansetron', rxNorm: '26225' },
  { pattern: /\bzofran\b/i, name: 'ondansetron', rxNorm: '26225' },
  // Pain / NSAIDs
  { pattern: /\bacetaminophen\b/i, name: 'acetaminophen', rxNorm: '161' },
  { pattern: /\btylenol\b/i, name: 'acetaminophen', rxNorm: '161' },
  { pattern: /\bibuprofen\b/i, name: 'ibuprofen', rxNorm: '5640' },
  { pattern: /\badvil\b/i, name: 'ibuprofen', rxNorm: '5640' },
  { pattern: /\bmotrin\b/i, name: 'ibuprofen', rxNorm: '5640' },
  { pattern: /\bnaproxen\b/i, name: 'naproxen', rxNorm: '7258' },
  { pattern: /\baleve\b/i, name: 'naproxen', rxNorm: '7258' },
  { pattern: /\baspirin\b/i, name: 'aspirin', rxNorm: '1191' },
  { pattern: /\bcelecoxib\b/i, name: 'celecoxib', rxNorm: '140587' },
  { pattern: /\bcelebrex\b/i, name: 'celecoxib', rxNorm: '140587' },
  { pattern: /\btramadol\b/i, name: 'tramadol', rxNorm: '10689' },
  { pattern: /\bmorphine\b/i, name: 'morphine', rxNorm: '7052' },
  { pattern: /\bhydrocodone\b/i, name: 'hydrocodone', rxNorm: '5489' },
  { pattern: /\boxycodone\b/i, name: 'oxycodone', rxNorm: '7804' },
  // Psych
  { pattern: /\bsertraline\b/i, name: 'sertraline', rxNorm: '36437' },
  { pattern: /\bzoloft\b/i, name: 'sertraline', rxNorm: '36437' },
  { pattern: /\bfluoxetine\b/i, name: 'fluoxetine', rxNorm: '4493' },
  { pattern: /\bprozac\b/i, name: 'fluoxetine', rxNorm: '4493' },
  { pattern: /\bcitalopram\b/i, name: 'citalopram', rxNorm: '2556' },
  { pattern: /\bescitalopram\b/i, name: 'escitalopram', rxNorm: '321988' },
  { pattern: /\blexapro\b/i, name: 'escitalopram', rxNorm: '321988' },
  { pattern: /\bduloxetine\b/i, name: 'duloxetine', rxNorm: '72625' },
  { pattern: /\bcymbalta\b/i, name: 'duloxetine', rxNorm: '72625' },
  { pattern: /\bbupropion\b/i, name: 'bupropion', rxNorm: '42347' },
  { pattern: /\bwellbutrin\b/i, name: 'bupropion', rxNorm: '42347' },
  { pattern: /\btrazodone\b/i, name: 'trazodone', rxNorm: '10737' },
  { pattern: /\balprazolam\b/i, name: 'alprazolam', rxNorm: '596' },
  { pattern: /\bxanax\b/i, name: 'alprazolam', rxNorm: '596' },
  { pattern: /\blorazepam\b/i, name: 'lorazepam', rxNorm: '6470' },
  { pattern: /\bativan\b/i, name: 'lorazepam', rxNorm: '6470' },
  { pattern: /\bgabapentin\b/i, name: 'gabapentin', rxNorm: '25480' },
  { pattern: /\bneurontin\b/i, name: 'gabapentin', rxNorm: '25480' },
  { pattern: /\bpregabalin\b/i, name: 'pregabalin', rxNorm: '187832' },
  { pattern: /\blyrica\b/i, name: 'pregabalin', rxNorm: '187832' },
  // Anticoagulants
  { pattern: /\bwarfarin\b/i, name: 'warfarin', rxNorm: '11289' },
  { pattern: /\bcoumadin\b/i, name: 'warfarin', rxNorm: '11289' },
  { pattern: /\bheparin\b/i, name: 'heparin', rxNorm: '5224' },
  { pattern: /\benoxaparin\b/i, name: 'enoxaparin', rxNorm: '67108' },
  { pattern: /\blovenox\b/i, name: 'enoxaparin', rxNorm: '67108' },
  { pattern: /\bapixaban\b/i, name: 'apixaban', rxNorm: '1364430' },
  { pattern: /\beliquis\b/i, name: 'apixaban', rxNorm: '1364430' },
  { pattern: /\brivaroxaban\b/i, name: 'rivaroxaban', rxNorm: '1114195' },
  { pattern: /\bxarelto\b/i, name: 'rivaroxaban', rxNorm: '1114195' },
  { pattern: /\bclopidogrel\b/i, name: 'clopidogrel', rxNorm: '32968' },
  { pattern: /\bplavix\b/i, name: 'clopidogrel', rxNorm: '32968' },
  // Respiratory
  { pattern: /\balbuterol\b/i, name: 'albuterol', rxNorm: '435' },
  { pattern: /\bventolin\b/i, name: 'albuterol', rxNorm: '435' },
  { pattern: /\bproair\b/i, name: 'albuterol', rxNorm: '435' },
  { pattern: /\bfluticasone\b/i, name: 'fluticasone', rxNorm: '4530' },
  { pattern: /\bmontelukast\b/i, name: 'montelukast', rxNorm: '88249' },
  { pattern: /\bsingulair\b/i, name: 'montelukast', rxNorm: '88249' },
  { pattern: /\btiotropium\b/i, name: 'tiotropium', rxNorm: '274783' },
  { pattern: /\bspiriv[ao]\b/i, name: 'tiotropium', rxNorm: '274783' },
  // Steroids / Anti-inflammatory
  { pattern: /\bprednisone\b/i, name: 'prednisone', rxNorm: '8640' },
  { pattern: /\bmethylprednisolone\b/i, name: 'methylprednisolone', rxNorm: '6902' },
  { pattern: /\bdexamethasone\b/i, name: 'dexamethasone', rxNorm: '3264' },
  // Antibiotics
  { pattern: /\bamoxicillin\b/i, name: 'amoxicillin', rxNorm: '723' },
  { pattern: /\bazithromycin\b/i, name: 'azithromycin', rxNorm: '18631' },
  { pattern: /\bzithromax\b/i, name: 'azithromycin', rxNorm: '18631' },
  { pattern: /\bz[- ]?pack\b/i, name: 'azithromycin', rxNorm: '18631' },
  { pattern: /\bciprofloxacin\b/i, name: 'ciprofloxacin', rxNorm: '2551' },
  { pattern: /\blevofloxacin\b/i, name: 'levofloxacin', rxNorm: '82122' },
  { pattern: /\bdoxycycline\b/i, name: 'doxycycline', rxNorm: '3640' },
  { pattern: /\bcephalexin\b/i, name: 'cephalexin', rxNorm: '2231' },
  { pattern: /\bkeflex\b/i, name: 'cephalexin', rxNorm: '2231' },
  { pattern: /\btrimethoprim\b/i, name: 'trimethoprim-sulfamethoxazole', rxNorm: '10831' },
  { pattern: /\bbactrim\b/i, name: 'trimethoprim-sulfamethoxazole', rxNorm: '10831' },
  { pattern: /\baugmentin\b/i, name: 'amoxicillin-clavulanate', rxNorm: '7980' },
  { pattern: /\bvancomycin\b/i, name: 'vancomycin', rxNorm: '11124' },
  { pattern: /\bpiperacillin\b/i, name: 'piperacillin-tazobactam', rxNorm: '8339' },
  { pattern: /\bzosyn\b/i, name: 'piperacillin-tazobactam', rxNorm: '8339' },
  // Thyroid
  { pattern: /\blevothyroxine\b/i, name: 'levothyroxine', rxNorm: '10582' },
  { pattern: /\bsynthroid\b/i, name: 'levothyroxine', rxNorm: '10582' },
  // Misc
  { pattern: /\ballopurinol\b/i, name: 'allopurinol', rxNorm: '519' },
  { pattern: /\bcolchicine\b/i, name: 'colchicine', rxNorm: '2683' },
  { pattern: /\bnitroglycer[iy]n\b/i, name: 'nitroglycerin', rxNorm: '7417' },
];

/** Dose pattern that follows a medication name */
const DOSE_PATTERN = /\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|iu|meq)\b(?:\s+(?:once|twice|three times|four times|every|q\.?\s*\d+\s*h|daily|bid|tid|qid|prn|as needed|at bedtime|qhs|qam|qpm|po|iv|im|subcut|sq|subcutaneous|oral|topical|inhaled|nebulized)(?:\s+(?:daily|a day|per day))?)?/i;

/** Vital sign patterns with LOINC codes */
const VITAL_PATTERNS: Array<{
  regex: RegExp;
  vitalName: string;
  loinc: string;
}> = [
  { regex: /\b(?:blood pressure|bp|b\.p\.)\s*(?:is\s*|of\s*|was\s*|at\s*|reading\s*(?:is\s*|of\s*)?)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/gi, vitalName: 'blood_pressure', loinc: '85354-9' },
  { regex: /\b(?:systolic)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,3})/gi, vitalName: 'systolic_bp', loinc: '8480-6' },
  { regex: /\b(?:diastolic)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,3})/gi, vitalName: 'diastolic_bp', loinc: '8462-4' },
  { regex: /\b(?:heart rate|pulse|hr|h\.r\.)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,3})\b/gi, vitalName: 'heart_rate', loinc: '8867-4' },
  { regex: /\b(?:temperature|temp)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,3}(?:\.\d{1,2})?)\s*(?:degrees?\s*)?(?:fahrenheit|celsius|f|c)?\b/gi, vitalName: 'temperature', loinc: '8310-5' },
  { regex: /\b(?:oxygen sat(?:uration)?|o2 sat|spo2|sp o2|pulse ox|o2)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,3})\s*%?\b/gi, vitalName: 'spo2', loinc: '2708-6' },
  { regex: /\b(?:respiratory rate|resp(?:iratory)? rate|rr|r\.r\.)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{1,2})\b/gi, vitalName: 'respiratory_rate', loinc: '9279-1' },
  { regex: /\b(?:weight)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,4}(?:\.\d{1,2})?)\s*(?:pounds?|lbs?|kg|kilograms?)\b/gi, vitalName: 'weight', loinc: '29463-7' },
  { regex: /\b(?:height)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{1,3}(?:\.\d{1,2})?)\s*(?:feet|foot|ft|inches|in|cm|centimeters?|meters?|m)\b/gi, vitalName: 'height', loinc: '8302-2' },
  { regex: /\bbmi\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{1,2}(?:\.\d{1,2})?)\b/gi, vitalName: 'bmi', loinc: '39156-5' },
  { regex: /\b(?:blood (?:sugar|glucose)|glucose|bs|bg|fasting glucose)\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{2,4})\b/gi, vitalName: 'blood_glucose', loinc: '2339-0' },
  { regex: /\bpain\s*(?:level|scale|score)?\s*(?:is\s*|of\s*|was\s*|at\s*)?(\d{1,2})\s*(?:out of\s*10|\/\s*10)?\b/gi, vitalName: 'pain_scale', loinc: '72514-3' },
];

/** Diagnosis patterns with ICD-10 codes */
const DIAGNOSIS_DB: Array<{
  pattern: RegExp;
  name: string;
  icd10: string;
}> = [
  // Cardiovascular
  { pattern: /\b(?:hypertension|high blood pressure|htn)\b/i, name: 'Essential hypertension', icd10: 'I10' },
  { pattern: /\b(?:congestive heart failure|chf|heart failure)\b/i, name: 'Heart failure, unspecified', icd10: 'I50.9' },
  { pattern: /\b(?:atrial fibrillation|a[ -]?fib|afib)\b/i, name: 'Atrial fibrillation', icd10: 'I48.91' },
  { pattern: /\b(?:coronary artery disease|cad)\b/i, name: 'Coronary artery disease', icd10: 'I25.10' },
  { pattern: /\b(?:myocardial infarction|heart attack|mi|stemi|nstemi)\b/i, name: 'Acute myocardial infarction', icd10: 'I21.9' },
  { pattern: /\b(?:deep vein thrombosis|dvt)\b/i, name: 'Deep vein thrombosis', icd10: 'I82.40' },
  { pattern: /\b(?:pulmonary embolism|pe)\b/i, name: 'Pulmonary embolism', icd10: 'I26.99' },
  { pattern: /\b(?:peripheral artery disease|pad|peripheral vascular disease|pvd)\b/i, name: 'Peripheral artery disease', icd10: 'I73.9' },
  { pattern: /\b(?:aortic stenosis)\b/i, name: 'Aortic stenosis', icd10: 'I35.0' },
  { pattern: /\b(?:hyperlipidemia|high cholesterol|dyslipidemia)\b/i, name: 'Hyperlipidemia', icd10: 'E78.5' },
  // Pulmonary
  { pattern: /\b(?:copd|chronic obstructive pulmonary disease)\b/i, name: 'COPD', icd10: 'J44.9' },
  { pattern: /\basthma\b/i, name: 'Asthma', icd10: 'J45.909' },
  { pattern: /\b(?:pneumonia)\b/i, name: 'Pneumonia', icd10: 'J18.9' },
  { pattern: /\b(?:pulmonary fibrosis)\b/i, name: 'Pulmonary fibrosis', icd10: 'J84.10' },
  { pattern: /\b(?:pleural effusion)\b/i, name: 'Pleural effusion', icd10: 'J90' },
  { pattern: /\b(?:upper respiratory infection|uri|common cold)\b/i, name: 'Upper respiratory infection', icd10: 'J06.9' },
  { pattern: /\b(?:acute bronchitis|bronchitis)\b/i, name: 'Acute bronchitis', icd10: 'J20.9' },
  // Endocrine
  { pattern: /\b(?:type 2 diabetes|type ii diabetes|dm2|t2dm|diabetes mellitus type 2|dm type 2|type two diabetes)\b/i, name: 'Type 2 diabetes mellitus', icd10: 'E11.9' },
  { pattern: /\b(?:type 1 diabetes|type i diabetes|dm1|t1dm|diabetes mellitus type 1|type one diabetes)\b/i, name: 'Type 1 diabetes mellitus', icd10: 'E10.9' },
  { pattern: /\bdiabetes\b/i, name: 'Diabetes mellitus', icd10: 'E11.9' },
  { pattern: /\b(?:hypothyroidism|underactive thyroid)\b/i, name: 'Hypothyroidism', icd10: 'E03.9' },
  { pattern: /\b(?:hyperthyroidism|overactive thyroid|graves)\b/i, name: 'Hyperthyroidism', icd10: 'E05.90' },
  { pattern: /\b(?:obesity|obese)\b/i, name: 'Obesity', icd10: 'E66.9' },
  // Renal
  { pattern: /\b(?:chronic kidney disease|ckd|renal insufficiency|kidney disease)\b/i, name: 'Chronic kidney disease', icd10: 'N18.9' },
  { pattern: /\b(?:acute kidney injury|aki|acute renal failure)\b/i, name: 'Acute kidney injury', icd10: 'N17.9' },
  { pattern: /\b(?:urinary tract infection|uti)\b/i, name: 'Urinary tract infection', icd10: 'N39.0' },
  { pattern: /\b(?:kidney stone|nephrolithiasis|renal calcul)/i, name: 'Nephrolithiasis', icd10: 'N20.0' },
  // GI
  { pattern: /\b(?:gerd|gastroesophageal reflux|acid reflux|reflux disease)\b/i, name: 'GERD', icd10: 'K21.0' },
  { pattern: /\b(?:peptic ulcer|stomach ulcer|gastric ulcer)\b/i, name: 'Peptic ulcer', icd10: 'K27.9' },
  { pattern: /\b(?:diverticulitis)\b/i, name: 'Diverticulitis', icd10: 'K57.92' },
  { pattern: /\b(?:cirrhosis|liver cirrhosis)\b/i, name: 'Cirrhosis of liver', icd10: 'K74.60' },
  { pattern: /\b(?:pancreatitis)\b/i, name: 'Pancreatitis', icd10: 'K85.9' },
  { pattern: /\b(?:irritable bowel|ibs)\b/i, name: 'Irritable bowel syndrome', icd10: 'K58.9' },
  { pattern: /\b(?:crohn'?s disease|crohn)\b/i, name: "Crohn's disease", icd10: 'K50.90' },
  { pattern: /\b(?:ulcerative colitis)\b/i, name: 'Ulcerative colitis', icd10: 'K51.90' },
  // Neurological
  { pattern: /\b(?:stroke|cerebrovascular accident|cva)\b/i, name: 'Stroke', icd10: 'I63.9' },
  { pattern: /\b(?:seizure disorder|epilepsy)\b/i, name: 'Epilepsy', icd10: 'G40.909' },
  { pattern: /\b(?:migraine)\b/i, name: 'Migraine', icd10: 'G43.909' },
  { pattern: /\b(?:parkinson'?s disease|parkinsonism)\b/i, name: "Parkinson's disease", icd10: 'G20' },
  { pattern: /\b(?:alzheimer'?s|dementia)\b/i, name: "Alzheimer's / Dementia", icd10: 'G30.9' },
  { pattern: /\b(?:neuropathy|peripheral neuropathy)\b/i, name: 'Peripheral neuropathy', icd10: 'G62.9' },
  // Musculoskeletal
  { pattern: /\b(?:osteoarthritis|degenerative joint disease|djd)\b/i, name: 'Osteoarthritis', icd10: 'M19.90' },
  { pattern: /\b(?:rheumatoid arthritis|ra)\b/i, name: 'Rheumatoid arthritis', icd10: 'M06.9' },
  { pattern: /\b(?:osteoporosis)\b/i, name: 'Osteoporosis', icd10: 'M81.0' },
  { pattern: /\b(?:gout)\b/i, name: 'Gout', icd10: 'M10.9' },
  { pattern: /\b(?:low back pain|lumbago|lower back pain)\b/i, name: 'Low back pain', icd10: 'M54.5' },
  // Psych
  { pattern: /\b(?:major depression|mdd|depressive disorder|clinical depression)\b/i, name: 'Major depressive disorder', icd10: 'F33.0' },
  { pattern: /\b(?:depression|depressed)\b/i, name: 'Depression', icd10: 'F32.9' },
  { pattern: /\b(?:anxiety|generalized anxiety|gad)\b/i, name: 'Anxiety disorder', icd10: 'F41.1' },
  { pattern: /\b(?:bipolar disorder|bipolar)\b/i, name: 'Bipolar disorder', icd10: 'F31.9' },
  { pattern: /\b(?:ptsd|post[- ]traumatic stress)\b/i, name: 'PTSD', icd10: 'F43.10' },
  { pattern: /\b(?:insomnia|sleep disorder)\b/i, name: 'Insomnia', icd10: 'G47.00' },
  // Infectious
  { pattern: /\b(?:sepsis|septicemia)\b/i, name: 'Sepsis', icd10: 'A41.9' },
  { pattern: /\bcellulitis\b/i, name: 'Cellulitis', icd10: 'L03.90' },
  { pattern: /\b(?:covid|covid[- ]?19|sars[- ]?cov[- ]?2)\b/i, name: 'COVID-19', icd10: 'U07.1' },
  { pattern: /\b(?:influenza|flu)\b/i, name: 'Influenza', icd10: 'J11.1' },
  // Heme/Onc
  { pattern: /\b(?:anemia|anaemia)\b/i, name: 'Anemia', icd10: 'D64.9' },
  { pattern: /\b(?:iron deficiency)\b/i, name: 'Iron deficiency anemia', icd10: 'D50.9' },
];

/** Lab order patterns with LOINC codes */
const LAB_DB: Array<{
  pattern: RegExp;
  name: string;
  loinc: string;
}> = [
  { pattern: /\b(?:cbc|complete blood count)\b/i, name: 'Complete blood count', loinc: '57021-8' },
  { pattern: /\b(?:bmp|basic metabolic panel)\b/i, name: 'Basic metabolic panel', loinc: '51990-0' },
  { pattern: /\b(?:cmp|comprehensive metabolic panel)\b/i, name: 'Comprehensive metabolic panel', loinc: '24323-8' },
  { pattern: /\b(?:lipid panel|lipids)\b/i, name: 'Lipid panel', loinc: '24331-1' },
  { pattern: /\b(?:hemoglobin a1c|hba1c|a1c|glycated hemoglobin)\b/i, name: 'Hemoglobin A1c', loinc: '4548-4' },
  { pattern: /\b(?:tsh|thyroid stimulating hormone)\b/i, name: 'TSH', loinc: '3016-3' },
  { pattern: /\btroponin\b/i, name: 'Troponin', loinc: '6598-7' },
  { pattern: /\b(?:bnp|brain natriuretic peptide|pro-?bnp|nt[- ]?pro[- ]?bnp)\b/i, name: 'BNP', loinc: '30934-4' },
  { pattern: /\blactate\b/i, name: 'Lactate', loinc: '2524-7' },
  { pattern: /\b(?:blood culture|blood cultures)\b/i, name: 'Blood culture', loinc: '600-7' },
  { pattern: /\b(?:urine culture|urine c&s)\b/i, name: 'Urine culture', loinc: '630-4' },
  { pattern: /\burinalysis\b/i, name: 'Urinalysis', loinc: '24356-8' },
  { pattern: /\b(?:ua\b)/i, name: 'Urinalysis', loinc: '24356-8' },
  { pattern: /\b(?:pt|prothrombin time)\b(?!\s*(?:education|therapy|physical))/i, name: 'Prothrombin time', loinc: '5902-2' },
  { pattern: /\b(?:inr)\b/i, name: 'INR', loinc: '6301-6' },
  { pattern: /\b(?:ptt|partial thromboplastin time)\b/i, name: 'PTT', loinc: '3173-2' },
  { pattern: /\b(?:d[- ]?dimer)\b/i, name: 'D-dimer', loinc: '48066-5' },
  { pattern: /\b(?:creatinine|cr)\b/i, name: 'Creatinine', loinc: '2160-0' },
  { pattern: /\b(?:bun|blood urea nitrogen)\b/i, name: 'BUN', loinc: '3094-0' },
  { pattern: /\b(?:ast|sgot|aspartate aminotransferase)\b/i, name: 'AST', loinc: '1920-8' },
  { pattern: /\b(?:alt|sgpt|alanine aminotransferase)\b/i, name: 'ALT', loinc: '1742-6' },
  { pattern: /\b(?:alkaline phosphatase|alk phos|alp)\b/i, name: 'Alkaline phosphatase', loinc: '6768-6' },
  { pattern: /\bbilirubin\b/i, name: 'Bilirubin', loinc: '1975-2' },
  { pattern: /\b(?:albumin)\b/i, name: 'Albumin', loinc: '1751-7' },
  { pattern: /\b(?:potassium|k\+)\b/i, name: 'Potassium', loinc: '2823-3' },
  { pattern: /\b(?:sodium|na\+)\b/i, name: 'Sodium', loinc: '2951-2' },
  { pattern: /\b(?:magnesium|mag|mg)\b(?!\s*(?:twice|daily|bid|tid|qid|po|iv|oral))/i, name: 'Magnesium', loinc: '2601-3' },
  { pattern: /\b(?:calcium|ca)\b(?!\s*(?:channel|blocker))/i, name: 'Calcium', loinc: '17861-6' },
  { pattern: /\b(?:phosphorus|phos)\b/i, name: 'Phosphorus', loinc: '2777-1' },
  { pattern: /\b(?:ferritin)\b/i, name: 'Ferritin', loinc: '2276-4' },
  { pattern: /\b(?:iron studies|serum iron|tibc)\b/i, name: 'Iron studies', loinc: '2498-4' },
  { pattern: /\b(?:vitamin d|vit d|25-?hydroxy)\b/i, name: 'Vitamin D', loinc: '1989-3' },
  { pattern: /\b(?:b12|vitamin b12|cobalamin)\b/i, name: 'Vitamin B12', loinc: '2132-9' },
  { pattern: /\b(?:folate|folic acid)\b/i, name: 'Folate', loinc: '2284-8' },
  { pattern: /\b(?:esr|sed rate|sedimentation rate)\b/i, name: 'ESR', loinc: '4537-7' },
  { pattern: /\b(?:crp|c[- ]?reactive protein)\b/i, name: 'CRP', loinc: '1988-5' },
  { pattern: /\b(?:hcg|pregnancy test|beta hcg)\b/i, name: 'HCG', loinc: '2106-3' },
  { pattern: /\b(?:psa|prostate specific antigen)\b/i, name: 'PSA', loinc: '2857-1' },
  { pattern: /\b(?:abg|arterial blood gas)\b/i, name: 'Arterial blood gas', loinc: '24336-0' },
  { pattern: /\b(?:blood type|type and screen|type and cross)\b/i, name: 'Type and screen', loinc: '882-1' },
];

/** Symptom patterns with SNOMED-CT codes */
const SYMPTOM_DB: Array<{
  pattern: RegExp;
  name: string;
  snomed: string;
}> = [
  { pattern: /\b(?:chest pain|chest tightness|chest discomfort)\b/i, name: 'Chest pain', snomed: '29857009' },
  { pattern: /\b(?:shortness of breath|sob|dyspnea|difficulty breathing|can'?t breathe|trouble breathing)\b/i, name: 'Dyspnea', snomed: '267036007' },
  { pattern: /\bheadache\b/i, name: 'Headache', snomed: '25064002' },
  { pattern: /\bnausea\b/i, name: 'Nausea', snomed: '422587007' },
  { pattern: /\bvomiting\b/i, name: 'Vomiting', snomed: '422400008' },
  { pattern: /\b(?:dizziness|dizzy|lightheaded|light[- ]?headed)\b/i, name: 'Dizziness', snomed: '404640003' },
  { pattern: /\b(?:fatigue|tired|exhausted|malaise)\b/i, name: 'Fatigue', snomed: '84229001' },
  { pattern: /\bfever\b/i, name: 'Fever', snomed: '386661006' },
  { pattern: /\b(?:cough|coughing)\b/i, name: 'Cough', snomed: '49727002' },
  { pattern: /\b(?:abdominal pain|stomach pain|belly pain|abd pain)\b/i, name: 'Abdominal pain', snomed: '21522001' },
  { pattern: /\b(?:back pain)\b/i, name: 'Back pain', snomed: '161891005' },
  { pattern: /\b(?:joint pain|arthralgia)\b/i, name: 'Joint pain', snomed: '57676002' },
  { pattern: /\b(?:swelling|edema|oedema|swollen)\b/i, name: 'Swelling', snomed: '65124004' },
  { pattern: /\brash\b/i, name: 'Rash', snomed: '271807003' },
  { pattern: /\b(?:numbness|numb)\b/i, name: 'Numbness', snomed: '44077006' },
  { pattern: /\b(?:tingling|paresthesia|pins and needles)\b/i, name: 'Tingling', snomed: '62507009' },
  { pattern: /\bweakness\b/i, name: 'Weakness', snomed: '13791008' },
  { pattern: /\b(?:palpitations|heart racing|heart pounding)\b/i, name: 'Palpitations', snomed: '80313002' },
  { pattern: /\b(?:sore throat|pharyngitis|throat pain)\b/i, name: 'Sore throat', snomed: '162397003' },
  { pattern: /\b(?:runny nose|rhinorrhea|nasal congestion|congestion)\b/i, name: 'Nasal congestion', snomed: '68235000' },
  { pattern: /\b(?:diarrhea|loose stools)\b/i, name: 'Diarrhea', snomed: '62315008' },
  { pattern: /\b(?:constipation)\b/i, name: 'Constipation', snomed: '14760008' },
  { pattern: /\b(?:blurred vision|blurry vision|vision changes)\b/i, name: 'Blurred vision', snomed: '111516008' },
  { pattern: /\b(?:wheezing|wheeze)\b/i, name: 'Wheezing', snomed: '56018004' },
  { pattern: /\b(?:loss of appetite|decreased appetite|anorexia|poor appetite)\b/i, name: 'Loss of appetite', snomed: '79890006' },
  { pattern: /\b(?:weight loss|lost weight|losing weight)\b/i, name: 'Weight loss', snomed: '89362005' },
  { pattern: /\b(?:weight gain|gained weight|gaining weight)\b/i, name: 'Weight gain', snomed: '8943002' },
  { pattern: /\b(?:insomnia|can'?t sleep|trouble sleeping|difficulty sleeping)\b/i, name: 'Insomnia', snomed: '193462001' },
  { pattern: /\b(?:urinary frequency|frequent urination|peeing a lot)\b/i, name: 'Urinary frequency', snomed: '162116003' },
  { pattern: /\b(?:dysuria|painful urination|burning (?:on|with) urination|burning when (?:i |he |she )?urinat)\b/i, name: 'Dysuria', snomed: '49650001' },
  { pattern: /\b(?:hematuria|blood in (?:the )?urine)\b/i, name: 'Hematuria', snomed: '34436003' },
  { pattern: /\b(?:hemoptysis|coughing (?:up )?blood)\b/i, name: 'Hemoptysis', snomed: '66857006' },
  { pattern: /\b(?:syncope|faint(?:ed|ing)?|passed out|lost consciousness)\b/i, name: 'Syncope', snomed: '271594007' },
  { pattern: /\b(?:diaphoresis|sweating|night sweats|sweaty)\b/i, name: 'Diaphoresis', snomed: '52613005' },
  { pattern: /\b(?:chills|rigors)\b/i, name: 'Chills', snomed: '43724002' },
];

/** Procedure patterns with CPT codes */
const PROCEDURE_DB: Array<{
  pattern: RegExp;
  name: string;
  cpt: string;
}> = [
  { pattern: /\b(?:ekg|ecg|electrocardiogram)\b/i, name: 'Electrocardiogram', cpt: '93000' },
  { pattern: /\b(?:echocardiogram|echo)\b/i, name: 'Echocardiogram', cpt: '93306' },
  { pattern: /\b(?:chest x[- ]?ray|cxr)\b/i, name: 'Chest X-ray', cpt: '71046' },
  { pattern: /\b(?:ct scan|cat scan|ct)\b(?:\s+(?:of|of the)\s+(?:head|brain|chest|abdomen|pelvis|abdomen and pelvis))?\b/i, name: 'CT scan', cpt: '74177' },
  { pattern: /\b(?:mri|magnetic resonance)\b/i, name: 'MRI', cpt: '70553' },
  { pattern: /\b(?:ultrasound|us|sonogram)\b/i, name: 'Ultrasound', cpt: '76700' },
  { pattern: /\b(?:stress test|treadmill test|exercise test)\b/i, name: 'Stress test', cpt: '93015' },
  { pattern: /\b(?:cardiac catheterization|cardiac cath|heart cath)\b/i, name: 'Cardiac catheterization', cpt: '93458' },
  { pattern: /\b(?:colonoscopy)\b/i, name: 'Colonoscopy', cpt: '45378' },
  { pattern: /\b(?:endoscopy|egd|upper endoscopy)\b/i, name: 'Upper endoscopy', cpt: '43239' },
  { pattern: /\b(?:lumbar puncture|spinal tap|lp)\b/i, name: 'Lumbar puncture', cpt: '62270' },
  { pattern: /\b(?:intubation|intubate)\b/i, name: 'Intubation', cpt: '31500' },
  { pattern: /\b(?:central line|central venous catheter|central venous access)\b/i, name: 'Central line placement', cpt: '36556' },
  { pattern: /\b(?:arterial line|a[- ]?line)\b/i, name: 'Arterial line', cpt: '36620' },
  { pattern: /\b(?:foley catheter|urinary catheter|foley)\b/i, name: 'Urinary catheterization', cpt: '51702' },
  { pattern: /\b(?:wound care|wound debridement|debridement)\b/i, name: 'Wound care', cpt: '97597' },
  { pattern: /\b(?:suture|stitches|laceration repair)\b/i, name: 'Laceration repair', cpt: '12001' },
  { pattern: /\b(?:I&D|incision and drainage)\b/i, name: 'Incision and drainage', cpt: '10060' },
  { pattern: /\b(?:joint aspiration|arthrocentesis)\b/i, name: 'Arthrocentesis', cpt: '20610' },
  { pattern: /\b(?:splint|splinting)\b/i, name: 'Splint application', cpt: '29105' },
  { pattern: /\b(?:nebulizer treatment|neb treatment|breathing treatment)\b/i, name: 'Nebulizer treatment', cpt: '94640' },
  { pattern: /\b(?:pulmonary function test|pft|spirometry)\b/i, name: 'Pulmonary function test', cpt: '94010' },
  { pattern: /\b(?:dialysis|hemodialysis)\b/i, name: 'Hemodialysis', cpt: '90935' },
  { pattern: /\b(?:biopsy)\b/i, name: 'Biopsy', cpt: '11102' },
  { pattern: /\b(?:transfusion|blood transfusion|prbc)\b/i, name: 'Blood transfusion', cpt: '36430' },
];

/** Allergy mention patterns */
const ALLERGY_PATTERNS: RegExp[] = [
  /\b(?:allergic to|allergy to|allergies to|allergies include|known allergy)\s+([^,.;]+)/gi,
  /\b([a-z]+)\s+allergy\b/gi,
  /\bno known (?:drug )?allergies?\b/gi,
  /\bnkda\b/gi,
  /\bnka\b/gi,
];

// ── EntityExtractor class ──────────────────────────────────────────────────

/**
 * EntityExtractor -- Medical NLP entity extraction module.
 *
 * Extracts structured clinical entities from transcript segments using:
 * 1. Claude API (primary) -- full medical NER with standard code mapping
 * 2. Comprehensive regex patterns (fallback) -- 50+ medications, vitals,
 *    diagnoses, labs, symptoms, procedures, allergies
 *
 * Each entity is tracked to its source segment for audit trail.
 * Entities are deduplicated across segments.
 */
export class EntityExtractor {
  private anthropicClient: Anthropic | null = null;

  constructor(anthropicApiKey?: string) {
    try {
      this.anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
    } catch {
      this.anthropicClient = null;
    }
  }

  /**
   * Extract clinical entities from an array of transcript segments.
   * Uses Claude API when available, falls back to regex patterns.
   * Deduplicates entities across all segments.
   */
  async extractFromSegments(segments: TranscriptSegment[]): Promise<ExtractionResult> {
    const startTime = Date.now();
    let usedAI = false;
    let allEntities: TrackedEntity[] = [];

    // Try Claude API first
    if (this.anthropicClient) {
      try {
        allEntities = await this.extractWithClaude(segments);
        usedAI = true;
      } catch {
        // Claude API failed -- fall through to regex
        allEntities = [];
      }
    }

    // Regex fallback
    if (!usedAI || allEntities.length === 0) {
      allEntities = this.extractWithRegex(segments);
      usedAI = false;
    }

    // Deduplicate
    const deduplicated = this.deduplicateEntities(allEntities);

    return {
      entities: deduplicated,
      usedAI,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Extract from a single text string (convenience method).
   * Wraps the text in a single segment for processing.
   */
  async extractFromText(text: string): Promise<ClinicalEntity[]> {
    const segment: TranscriptSegment = {
      speaker: 'unknown',
      text,
      startTime: 0,
      endTime: 0,
      confidence: 1.0,
    };
    const result = await this.extractFromSegments([segment]);
    return result.entities;
  }

  // ── Claude API extraction ──────────────────────────────────────────────

  private async extractWithClaude(segments: TranscriptSegment[]): Promise<TrackedEntity[]> {
    // Build the full transcript with segment markers for source tracking
    const numberedTranscript = segments
      .map((s, i) => `[SEGMENT ${i} | ${s.speaker.toUpperCase()}]: ${s.text}`)
      .join('\n');

    const response = await this.anthropicClient!.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `<instructions>
You are a medical NER (Named Entity Recognition) system. Extract ALL clinical entities from the transcript below.

For each entity return a JSON object with these fields:
- segmentIndex: integer index of the source segment (from [SEGMENT N] markers)
- type: one of "medication", "vital", "symptom", "diagnosis", "procedure", "lab_order", "allergy", "dosage"
- text: exact text from the transcript
- normalized: standardized clinical name (generic drug name, standard vital name, etc.)
- code: standard code if identifiable (RxNorm CUI, LOINC, SNOMED-CT, ICD-10, or CPT code)
- codeSystem: one of "RxNorm", "LOINC", "SNOMED-CT", "ICD-10", "CPT"
- confidence: 0.0 to 1.0

Code mapping rules:
- Medications -> RxNorm
- Vital signs and lab orders -> LOINC
- Symptoms and clinical findings -> SNOMED-CT
- Diagnoses -> ICD-10
- Procedures -> CPT
- Allergies -> no code required (set code to null)
- Dosages -> no code required (set code to null)

For medications, include dose/route/frequency as a separate "dosage" entity.
For allergies, note "NKDA" or "NKA" as a normalized "no known allergies" entity.
Only extract entities clearly present in the text. Do NOT hallucinate.

Respond with ONLY a JSON array. No markdown fences, no explanation.
</instructions>

<transcript>
${numberedTranscript}
</transcript>`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const cleaned = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const rawEntities = JSON.parse(cleaned) as Array<{
      segmentIndex?: number;
      type?: string;
      text?: string;
      normalized?: string;
      code?: string | null;
      codeSystem?: string | null;
      confidence?: number;
    }>;

    const validTypes = new Set([
      'symptom', 'medication', 'dosage', 'vital', 'procedure', 'diagnosis', 'allergy', 'lab_order',
    ]);
    const validCodeSystems = new Set(['ICD-10', 'SNOMED-CT', 'RxNorm', 'LOINC', 'CPT']);

    return rawEntities
      .filter((e) => e.type && validTypes.has(e.type) && e.text)
      .map((e) => {
        const segIdx = typeof e.segmentIndex === 'number' && e.segmentIndex >= 0 && e.segmentIndex < segments.length
          ? e.segmentIndex
          : 0;
        const seg = segments[segIdx];
        return {
          type: e.type as ClinicalEntity['type'],
          text: e.text!,
          normalized: e.normalized || undefined,
          code: (e.code && typeof e.code === 'string') ? e.code : undefined,
          codeSystem: (e.codeSystem && typeof e.codeSystem === 'string' && validCodeSystems.has(e.codeSystem))
            ? (e.codeSystem as ClinicalEntity['codeSystem'])
            : undefined,
          confidence: typeof e.confidence === 'number'
            ? Math.max(0, Math.min(1, e.confidence))
            : 0.7,
          sourceSegmentIndex: segIdx,
          sourceSpeaker: seg.speaker,
          sourceTimeRange: { start: seg.startTime, end: seg.endTime },
        };
      });
  }

  // ── Regex fallback extraction ──────────────────────────────────────────

  private extractWithRegex(segments: TranscriptSegment[]): TrackedEntity[] {
    const entities: TrackedEntity[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const text = seg.text;
      const meta = {
        sourceSegmentIndex: i,
        sourceSpeaker: seg.speaker as TranscriptSegment['speaker'],
        sourceTimeRange: { start: seg.startTime, end: seg.endTime },
      };

      // ── Medications ──
      for (const med of MEDICATION_DB) {
        // Reset regex lastIndex for global patterns
        med.pattern.lastIndex = 0;
        const match = med.pattern.exec(text);
        if (match) {
          const fullMatchStart = match.index + match[0].length;
          const remainingText = text.substring(fullMatchStart);
          const doseMatch = DOSE_PATTERN.exec(remainingText);

          entities.push({
            type: 'medication',
            text: match[0].trim(),
            normalized: med.name,
            code: med.rxNorm,
            codeSystem: 'RxNorm',
            confidence: 0.85,
            ...meta,
          });

          if (doseMatch) {
            entities.push({
              type: 'dosage',
              text: doseMatch[0].trim(),
              normalized: doseMatch[0].trim(),
              confidence: 0.9,
              ...meta,
            });
          }
        }
      }

      // ── Vitals ──
      for (const vital of VITAL_PATTERNS) {
        vital.regex.lastIndex = 0;
        let match;
        while ((match = vital.regex.exec(text)) !== null) {
          entities.push({
            type: 'vital',
            text: match[0].trim(),
            normalized: vital.vitalName,
            code: vital.loinc,
            codeSystem: 'LOINC',
            confidence: 0.9,
            ...meta,
          });
        }
      }

      // ── Symptoms ──
      for (const symptom of SYMPTOM_DB) {
        symptom.pattern.lastIndex = 0;
        const match = symptom.pattern.exec(text);
        if (match) {
          entities.push({
            type: 'symptom',
            text: match[0].trim(),
            normalized: symptom.name,
            code: symptom.snomed,
            codeSystem: 'SNOMED-CT',
            confidence: 0.8,
            ...meta,
          });
        }
      }

      // ── Diagnoses ──
      for (const dx of DIAGNOSIS_DB) {
        dx.pattern.lastIndex = 0;
        const match = dx.pattern.exec(text);
        if (match) {
          entities.push({
            type: 'diagnosis',
            text: match[0].trim(),
            normalized: dx.name,
            code: dx.icd10,
            codeSystem: 'ICD-10',
            confidence: 0.8,
            ...meta,
          });
        }
      }

      // ── Lab orders ──
      for (const lab of LAB_DB) {
        lab.pattern.lastIndex = 0;
        const match = lab.pattern.exec(text);
        if (match) {
          entities.push({
            type: 'lab_order',
            text: match[0].trim(),
            normalized: lab.name,
            code: lab.loinc,
            codeSystem: 'LOINC',
            confidence: 0.85,
            ...meta,
          });
        }
      }

      // ── Procedures ──
      for (const proc of PROCEDURE_DB) {
        proc.pattern.lastIndex = 0;
        const match = proc.pattern.exec(text);
        if (match) {
          entities.push({
            type: 'procedure',
            text: match[0].trim(),
            normalized: proc.name,
            code: proc.cpt,
            codeSystem: 'CPT',
            confidence: 0.8,
            ...meta,
          });
        }
      }

      // ── Allergies ──
      for (const allergyPattern of ALLERGY_PATTERNS) {
        allergyPattern.lastIndex = 0;
        let match;
        while ((match = allergyPattern.exec(text)) !== null) {
          const matchedText = match[0].trim();
          const isNKDA = /\b(?:no known|nkda|nka)\b/i.test(matchedText);
          entities.push({
            type: 'allergy',
            text: matchedText,
            normalized: isNKDA ? 'No known allergies' : (match[1]?.trim() || matchedText),
            confidence: isNKDA ? 0.95 : 0.75,
            ...meta,
          });
        }
      }
    }

    return entities;
  }

  // ── Deduplication ──────────────────────────────────────────────────────

  /**
   * Deduplicate entities by (type + normalized name), keeping the one
   * with the highest confidence score.  Preserves the first source reference.
   */
  private deduplicateEntities(entities: TrackedEntity[]): TrackedEntity[] {
    const seen = new Map<string, TrackedEntity>();

    for (const entity of entities) {
      const key = `${entity.type}::${(entity.normalized || entity.text).toLowerCase()}`;

      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, entity);
      } else if (entity.confidence > existing.confidence) {
        // Keep higher-confidence version but preserve earlier source reference
        seen.set(key, {
          ...entity,
          sourceSegmentIndex: Math.min(entity.sourceSegmentIndex, existing.sourceSegmentIndex),
        });
      }
    }

    return Array.from(seen.values());
  }
}
