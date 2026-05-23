import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { AUTHOR_BOOK, AUTHOR_TEAMS } from "./authors";
import type { AuthorTeam } from "./authors";

type Mode = "inspection" | "blank-report" | "air-purifier" | "samsung-note";

type CopyResult = {
  ok: boolean;
  message: string;
};

type ModelSerial = {
  model: string;
  serial: string;
};

type ResultItem = {
  content: string;
  warning?: string;
};

type TestMode = Mode | "shared";

type TestCase = {
  name: string;
  input: string;
  mode: TestMode;
  expected?: string;
  expectedFunction?: boolean;
};

type TestResult = TestCase & {
  passed: boolean;
  actual: string;
};

type ModeConfig = {
  label: string;
  accent: string;
  bgSoft: string;
  textDark: string;
  placeholder: string;
};

const MODE_ORDER: Mode[] = ["inspection", "blank-report", "air-purifier", "samsung-note"];

const MODE_CONFIG: Record<Mode, ModeConfig> = {
  inspection: {
    label: "점검",
    accent: "#185FA5",
    bgSoft: "#E6F1FB",
    textDark: "#0C447C",
    placeholder: "여기에 -시작- 부터 -끝- 까지의 원본 점검이력을 붙여넣으세요.",
  },
  "blank-report": {
    label: "미양식",
    accent: "#0F6E56",
    bgSoft: "#E1F5EE",
    textDark: "#04342C",
    placeholder: "여기에 스케줄 원문을 문단별로 붙여넣으세요.",
  },
  "air-purifier": {
    label: "청정기",
    accent: "#993C1D",
    bgSoft: "#FAECE7",
    textDark: "#4A1B0C",
    placeholder: "여기에 공기청정기 점검이력 원본을 붙여넣으세요.",
  },
  "samsung-note": {
    label: "삼성노트",
    accent: "#534AB7",
    bgSoft: "#EEEDFE",
    textDark: "#26215C",
    placeholder: "여기에 번호가 붙은 스케줄 원문을 여러 개 붙여넣으세요.",
  },
};

const ITEM_DIVIDER = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";
const SECTION_DIVIDER = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";

// ────────────────────────────────────────────────────────────────────────────
// Shared text utilities
// ────────────────────────────────────────────────────────────────────────────

// Recognizes divider lines made of ASCII `-`/`_`, ㅡ (U+3161, our new default for Samsung Notes safety),
// `═` (U+2550), and common Unicode dashes/box-drawing chars that appear when output is round-tripped
// through apps like Samsung Notes.
const DIVIDER_CHAR_CLASS = "[-_\\u3161\\u2550\\u2500\\u2501\\u23BC\\u2015\\u2014\\u2013]";
const DIVIDER_LINE_REGEX = new RegExp(`^\\s*${DIVIDER_CHAR_CLASS}{3,}\\s*$`);

function isDividerLine(line: string): boolean {
  return DIVIDER_LINE_REGEX.test(line);
}

function findLine(lines: string[], regex: RegExp): string | null {
  return lines.find((line: string) => regex.test(line)) || null;
}

function normalizeLabelSpacing(line: string): string {
  return line.replace(/^([^:]+):\s*/, "$1: ");
}

function collectMultilineField(
  cleaned: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[],
  normalizeFirst = true,
  breakOnNumberedItem = true
): string[] {
  const startIndex = cleaned.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const firstLine = normalizeFirst ? normalizeLabelSpacing(cleaned[startIndex]) : cleaned[startIndex];
  const collected: string[] = [firstLine];

  for (let i = startIndex + 1; i < cleaned.length; i += 1) {
    const nextLine = cleaned[i];
    if (stopRegex.test(nextLine)) break;
    if (breakOnNumberedItem && /^\d+\./.test(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function collectHeaderMultiline(
  lines: string[],
  startRegex: RegExp,
  stopRegex: RegExp,
  defaultLines: string[]
): string[] {
  const startIndex = lines.findIndex((line: string) => startRegex.test(line));
  if (startIndex < 0) return defaultLines;

  const collected: string[] = [normalizeLabelSpacing(lines[startIndex])];

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const nextLine = lines[i];
    if (stopRegex.test(nextLine)) break;
    if (isDividerLine(nextLine)) break;
    collected.push(nextLine);
  }

  return collected;
}

function buildItemTitleLine(cleaned: string[], blockIndex: number): string {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  // Preserve & normalize existing title (all legacy formats → N.)
  const titleMatch = firstLine.match(/^(?:(\d+)\.|\((\d+)\)|【(\d+)】)\s*(.*)$/);
  if (titleMatch) {
    const num = titleMatch[1] || titleMatch[2] || titleMatch[3];
    const rest = (titleMatch[4] || "").trim();
    return rest ? `${num}. ${rest}` : `${num}.`;
  }

  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) {
    return `${blockIndex + 1}. ${firstLine.trim()}`;
  }

  return `${blockIndex + 1}.`;
}

function stripConsumedTitleLine(cleaned: string[]): string[] {
  const firstLine = cleaned[0] || "";
  const modelIndex = cleaned.findIndex((line: string) => /^모델명\s*:/.test(line));

  if (/^(?:\d+\.|\(\d+\)|【\d+】)/.test(firstLine)) return cleaned.slice(1);
  if (modelIndex > 0 && firstLine && !/:/.test(firstLine)) return cleaned.slice(1);

  return cleaned;
}

function splitItemBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isDividerLine(line)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    // 【N】 or 【N】 텍스트 also marks the start of a new item block
    if (/^【\d+】/.test(line.trim())) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      current.push(line);
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function extractHeader(headerLines: string[]): string[] {
  const gradeLines = collectHeaderMultiline(
    headerLines,
    /^등급\s*:/,
    /^(작성자|구분|레벨|업체명|부서명|지역|키맨\/접수자)\s*:/,
    ["등급:  "]
  );
  const companyLines = collectHeaderMultiline(
    headerLines,
    /^업체명\s*:/,
    /^(작성자|구분|레벨|등급|부서명|지역|키맨\/접수자)\s*:/,
    ["업체명: "]
  );
  const departmentLines = collectHeaderMultiline(
    headerLines,
    /^부서명\s*:/,
    /^(작성자|구분|레벨|등급|업체명|지역|키맨\/접수자)\s*:/,
    ["부서명: "]
  );
  const regionLines = collectHeaderMultiline(
    headerLines,
    /^지역\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|키맨\/접수자)\s*:/,
    ["지역: "]
  );
  const keymanLines = collectHeaderMultiline(
    headerLines,
    /^키맨\/접수자\s*:/,
    /^(작성자|구분|레벨|등급|업체명|부서명|지역)\s*:/,
    ["키맨/접수자:"]
  );

  return [
    "작성자: ",
    "구분: 점검",
    "레벨: 1",
    ...gradeLines,
    ...companyLines,
    ...departmentLines,
    ...regionLines,
    ...keymanLines,
  ];
}

function findPartsSectionEnd(bodyLines: string[]): number {
  const partsIndex = bodyLines.findIndex((line: string) => /^\s*※부품신청※\s*$/.test(line));
  const selfIndex = bodyLines.findIndex((line: string) => /^\s*※자가신청※\s*$/.test(line));
  const arrivalIndex = bodyLines.findIndex((line: string) => /^도착 시간\s*:/.test(line));
  const durationIndex = bodyLines.findIndex((line: string) => /^소요 시간\s*:/.test(line));

  let end = bodyLines.length;
  if (partsIndex >= 0) end = Math.min(end, partsIndex);
  if (selfIndex >= 0) end = Math.min(end, selfIndex);
  if (arrivalIndex >= 0) end = Math.min(end, arrivalIndex);
  if (durationIndex >= 0) end = Math.min(end, durationIndex);
  return end;
}

const STANDARD_PARTS_SECTION: string[] = [
  SECTION_DIVIDER,
  "※부품신청※",
  "보증기간 내 여부 : ",
  "교체 전 카운터 누적 사용매수 : ",
  "사용 부품 예상 사용매수 : ",
  "▶ 신청 부품",
  "물품명:",
  "수량:",
  "출고여부: ",
  SECTION_DIVIDER,
  "※자가신청※",
  "물품:",
  "수량:",
  "출고여부:",
  ITEM_DIVIDER,
  "도착 시간:",
  "소요 시간:",
];

// ────────────────────────────────────────────────────────────────────────────
// Mode 1: Inspection (점검이력 변환)
// ────────────────────────────────────────────────────────────────────────────

function collectExtraLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^여분\s*:/,
    /^(한틴이카유무|주차비지원유무|특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통)\s*:/,
    ["여분: K- C- M- Y- 폐- "]
  );
}

function collectNoteLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^특이사항\s*:/,
    /^(모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무)\s*:/,
    ["특이사항:"]
  );
}

function collectParkingLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^주차비지원유무\s*:/,
    /^(특이사항|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무)\s*:/,
    ["주차비지원유무: "]
  );
}

function normalizeInspectionItemBlock(blockLines: string[], blockIndex: number): string[] {
  const cleaned = blockLines
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line !== "" && !isDividerLine(line));

  if (cleaned.length === 0) return [];

  const titleLine = buildItemTitleLine(cleaned, blockIndex);
  const contentLines = stripConsumedTitleLine(cleaned);

  const modelLine = findLine(contentLines, /^모델명\s*:/);
  const serialLine = findLine(contentLines, /^시리얼넘버\s*:/);
  const assetLine = findLine(contentLines, /^자산기번\s*:/);
  const hantinLine = findLine(contentLines, /^한틴이카유무\s*:/) || "한틴이카유무:";
  const extraLines = collectExtraLines(contentLines);
  const parkingLines = collectParkingLines(contentLines);
  const noteLines = collectNoteLines(contentLines);

  return [
    titleLine,
    modelLine || "모델명:",
    serialLine || "시리얼넘버:",
    assetLine || "자산기번: ",
    "내용: 정기점검",
    "처리내용: 정기점검",
    "매수: 흑-    컬-    큰컬-    합-",
    "토너잔량:K-   C-   M-   Y-",
    "폐통:        %",
    ...extraLines,
    hantinLine,
    ...parkingLines,
    ...noteLines,
  ];
}

function transformInspectionText(input: string): string {
  if (!input || !input.trim()) return "";

  const lines = input.split(/\r?\n/);
  const firstDividerIndex = lines.findIndex((line: string) => isDividerLine(line));
  const itemStartIndex = firstDividerIndex >= 0 ? firstDividerIndex : lines.length;
  const headerLines = lines.slice(0, itemStartIndex);
  const bodyLines = lines.slice(itemStartIndex);

  const normalizedHeader = extractHeader(headerLines);
  const itemSectionEnd = findPartsSectionEnd(bodyLines);
  const rawItemSection = bodyLines.slice(0, itemSectionEnd);
  const itemBlocks = splitItemBlocks(rawItemSection);
  const normalizedItemSection: string[] = [];

  itemBlocks.forEach((block: string[], index: number) => {
    const normalizedBlock = normalizeInspectionItemBlock(block, index);
    if (normalizedBlock.length === 0) return;
    normalizedItemSection.push(ITEM_DIVIDER);
    normalizedItemSection.push(...normalizedBlock);
  });

  return [...normalizedHeader, ...normalizedItemSection, ...STANDARD_PARTS_SECTION].join("\n");
}

function collectAirPurifierNoteLines(cleaned: string[]): string[] {
  return collectMultilineField(
    cleaned,
    /^특이사항\s*:/,
    /^(모델명|시리얼넘버|자산기번|내용|처리내용|필터리셋|필터교체)\s*:/,
    ["특이사항:"]
  );
}

function normalizeAirPurifierItemBlock(blockLines: string[], blockIndex: number): string[] {
  const cleaned = blockLines
    .map((line: string) => line.trimEnd())
    .filter((line: string) => line !== "" && !isDividerLine(line));

  if (cleaned.length === 0) return [];

  const titleLine = buildItemTitleLine(cleaned, blockIndex);
  const contentLines = stripConsumedTitleLine(cleaned);

  const modelLine = findLine(contentLines, /^모델명\s*:/);
  const serialLine = findLine(contentLines, /^시리얼넘버\s*:/);
  const assetLine = findLine(contentLines, /^자산기번\s*:/);
  const filterResetLine = findLine(contentLines, /^필터리셋\s*:/) || "필터리셋:";
  const filterReplaceLine = findLine(contentLines, /^필터교체\s*:/) || "필터교체:";
  const noteLines = collectAirPurifierNoteLines(contentLines);

  return [
    titleLine,
    modelLine || "모델명:",
    serialLine || "시리얼넘버:",
    assetLine || "자산기번: ",
    "내용: 정기점검",
    "처리내용: 정기점검",
    filterResetLine,
    filterReplaceLine,
    ...noteLines,
  ];
}

function transformAirPurifierStructured(input: string): string {
  const lines = input.split(/\r?\n/);
  const firstDividerIndex = lines.findIndex((line: string) => isDividerLine(line));
  const itemStartIndex = firstDividerIndex >= 0 ? firstDividerIndex : lines.length;
  const headerLines = lines.slice(0, itemStartIndex);
  const bodyLines = lines.slice(itemStartIndex);

  const normalizedHeader = extractHeader(headerLines);
  const itemSectionEnd = findPartsSectionEnd(bodyLines);
  const rawItemSection = bodyLines.slice(0, itemSectionEnd);
  const itemBlocks = splitItemBlocks(rawItemSection);
  const normalizedItemSection: string[] = [];

  itemBlocks.forEach((block: string[], index: number) => {
    const normalizedBlock = normalizeAirPurifierItemBlock(block, index);
    if (normalizedBlock.length === 0) return;
    normalizedItemSection.push(ITEM_DIVIDER);
    normalizedItemSection.push(...normalizedBlock);
  });

  return [...normalizedHeader, ...normalizedItemSection, ...STANDARD_PARTS_SECTION].join("\n");
}

function buildAirPurifierFromFields(
  blockIndex: number,
  grade: string,
  company: string,
  department: string,
  keyman: string,
  model: string,
  serial: string,
  assetNumber: string
): string[] {
  const header = [
    "작성자: ",
    "구분: 점검",
    "레벨: 1",
    `등급: ${grade}`,
    `업체명: ${company}`,
    `부서명: ${department}`,
    "지역: C",
    `키맨/접수자:${keyman}`,
  ];

  const item = [
    ITEM_DIVIDER,
    `${blockIndex + 1}.`,
    `모델명: ${model}`,
    `시리얼넘버: ${serial}`,
    `자산기번: ${assetNumber}`,
    "내용: 정기점검",
    "처리내용: 정기점검",
    "필터리셋:",
    "필터교체:",
    "특이사항:",
  ];

  return [...header, ...item];
}

function buildAirPurifierFromCompact(input: string): string {
  const blocks = splitCompactBlocks(input);
  const sections: string[] = [];

  blocks.forEach((block: string[], index: number) => {
    if (block.length === 0) return;

    const gradeCompanyLine = block[0] || "";
    const modelSerialLine = block[1] || "";
    const addressLine = block[2] || "";
    const phoneLines = block.slice(3);

    const grade = extractGrade(gradeCompanyLine);
    const company = extractCompactCompany(gradeCompanyLine);
    const { model, serial } = parseCompactModelSerial(modelSerialLine);
    const department = extractDepartment(addressLine);
    const keymanSegments = phoneLines.flatMap((l: string) => splitPhoneLine(l));
    const keyman = keymanSegments.length > 0 ? keymanSegments.join("\n") : "";

    const out = buildAirPurifierFromFields(
      index,
      grade,
      company,
      department,
      keyman,
      model,
      serial,
      ""
    );

    if (index === 0) {
      sections.push(...out);
    } else {
      // subsequent blocks: repeat only item section (kept minimal — rare case)
      sections.push(...out);
    }
  });

  sections.push(...STANDARD_PARTS_SECTION);
  return sections.join("\n");
}

function buildAirPurifierFromTable(input: string): string {
  const rawText = input;
  const flatText = input.replace(/[\t\r]+/g, " ");

  const grade = extractGrade(flatText);
  const company = extractTableCompany(rawText);
  const department = extractDepartment(flatText);
  const keyman = extractTableKeyman(rawText);
  const tableMs = extractTableModelSerial(rawText);
  const fallbackMs = extractModelAndSerial(flatText);
  const ms: ModelSerial = {
    model: tableMs.model || fallbackMs.model,
    serial: tableMs.serial || fallbackMs.serial,
  };
  const assetNumber = extractAssetNumber(flatText);

  const out = buildAirPurifierFromFields(
    0,
    grade,
    company,
    department,
    keyman,
    ms.model,
    ms.serial,
    assetNumber
  );

  return [...out, ...STANDARD_PARTS_SECTION].join("\n");
}

function transformAirPurifierText(input: string): string {
  if (!input || !input.trim()) return "";

  const format = detectInputFormat(input);
  if (format === "compact") return buildAirPurifierFromCompact(input);
  if (format === "table") return buildAirPurifierFromTable(input);
  return transformAirPurifierStructured(input);
}

// ────────────────────────────────────────────────────────────────────────────
// Shared multi-format extractors (used by Air Purifier and Blank Report)
// ────────────────────────────────────────────────────────────────────────────

type InputFormat = "compact" | "structured" | "table";

function detectInputFormat(input: string): InputFormat {
  if (
    /기번\s+\S/.test(input) ||
    /접수자성함\s+\S/.test(input) ||
    /접수자연락처\s+\S/.test(input) ||
    /★?키맨성함\/번호\s+\S/.test(input) ||
    /자산번호\s+[A-Z]/.test(input)
  ) {
    return "table";
  }

  if (/^\s*구분\s*:/m.test(input) && /^\s*업체명\s*:/m.test(input)) {
    return "structured";
  }

  return "compact";
}

// Company extraction — handles "17S㈜프리즘산업-매월마감" or "31SS주식회사 에이피더핀..."
function extractCompactCompany(line: string): string {
  const match = line.match(
    /^\s*\d+(?:NN|SS|S|N|V)([^\n]*?)(?:분기마감|매월마감|매년마감|오픈\s*\d*시?반?|단순마감마감|단순마감|$)/
  );
  if (!match) return "";
  return match[1]
    .trim()
    .replace(/^㈜\s*/, "")
    .replace(/-\s*$/, "")
    .trim();
}

// Table-format company — preserves newlines inside quoted "19V...매월마감" blocks
function extractTableCompany(rawText: string): string {
  const stripMarks = (s: string): string =>
    s
      .replace(/^㈜\s*/, "")
      .replace(/\s*㈜\s*$/, "")
      .replace(/^\(주\)\s*/, "")
      .replace(/\s*\(주\)\s*$/, "")
      .trim();

  const quotedGradeMatch = rawText.match(
    /"\s*\d+(?:NN|SS|S|N|V)?\s*([\s\S]*?)\s*(?:분기마감|매월마감|매년마감)\s*"/
  );
  if (quotedGradeMatch) {
    return stripMarks(quotedGradeMatch[1].trim());
  }

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const gradeMatch = line.match(
      /^\s*\d+(?:NN|SS|S|N|V)([^\n]*?)(?:분기마감|매월마감|매년마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
    );
    if (gradeMatch) {
      return stripMarks(gradeMatch[1].trim().replace(/-\s*$/, ""));
    }
  }

  return stripMarks(extractCompanyForTemplate(rawText).replace(/-\s*$/, ""));
}

// Table-format model/serial — handles tab-separated "기종\tMODEL\t..." and "기번\t\"SERIAL\n..."
function extractTableModelSerial(rawText: string): ModelSerial {
  // Model: "기종" + tab/whitespace + value + (tab/newline/next-label)
  const modelMatch = rawText.match(
    /기종\s*[\t ]+\s*"?\s*([^\t\n"]+?)\s*(?:"|\t|\n|기기상태|접수분야|$)/
  );
  // Serial: "기번" + tab/whitespace + optional quote + alphanumeric (first line only)
  const serialMatch = rawText.match(/기번\s*[\t ]+\s*"?\s*([A-Z0-9-]+)/i);

  return {
    model: modelMatch ? modelMatch[1].trim() : "",
    serial: serialMatch ? serialMatch[1].trim() : "",
  };
}

// Table-format report type — reads 접수분야 field (handles 샘플전달, 점검, A/S, 여분요청, etc.)
function extractTableReportType(rawText: string): string {
  // Matches at line start OR after tab/space (since "접수유형 X 접수분야 Y" has both on same line)
  const match = rawText.match(/(?:^|[\t ])접수분야[\t ]+([^\t\n]+?)(?=[\t\n]|$)/);
  if (match) {
    const t = match[1].trim();
    if (t) return t;
  }
  return "";
}

// Table-format 상태 field — captures multi-line values, strips outer quotes,
// stops at next known field label at line start
function extractStatusTextFromRaw(rawText: string): string {
  const startMatch = rawText.match(/^\s*상태\s+/m);
  if (!startMatch) return "";

  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  const remaining = rawText.slice(startIdx);

  const boundaryMatch = remaining.match(
    /^\s*(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소|미수개월|한조\/틴텍코드|★?키맨성함\/번호|접수자성함|접수자연락처|일반전화|설치업체|기본임대료|방문주기|납품\/교체일|종료일|계약일|임대리스트순번|접수유형|접수분야|기번|장비소유주|확장성|교체일로부터|교체이력|사용개월|남은개월|평균임대료|유지보수업체)/m
  );

  const endIdx = boundaryMatch ? (boundaryMatch.index ?? remaining.length) : remaining.length;
  let value = remaining.slice(0, endIdx).trim();

  // Strip outer matching quotes (e.g., `" MA2101...\n...함"`)
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

// Table-format 지역 extraction — reads 방문담당자 value (e.g., "수도권A" → "A")
function extractTableRegion(rawText: string): string {
  const match = rawText.match(/방문담당자[\t ]+[^\t\n]*?([A-E])(?=[\t \n]|$)/);
  if (match) return match[1];
  return "";
}

// Compact model/serial: "샤오미 MI-AIR/318115/00036240" → model + (rest as serial)
function parseCompactModelSerial(line: string): ModelSerial {
  const trimmed = line.trim();
  const firstSlash = trimmed.indexOf("/");
  if (firstSlash < 0) return { model: trimmed, serial: "" };
  return {
    model: trimmed.slice(0, firstSlash).trim(),
    serial: trimmed.slice(firstSlash + 1).trim(),
  };
}

// Split phone line like "010-A 김/010-B 이 070-C 박" into one line per contact
function splitPhoneLine(rawLine: string): string[] {
  const segments = rawLine
    .split("/")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const result: string[] = [];
  for (const seg of segments) {
    const phoneMatches = [...seg.matchAll(/\d{2,3}-?\d{3,4}-?\d{4}/g)];
    if (phoneMatches.length <= 1) {
      result.push(seg);
      continue;
    }
    for (let i = 0; i < phoneMatches.length; i += 1) {
      const start = phoneMatches[i].index ?? 0;
      const end =
        i + 1 < phoneMatches.length ? (phoneMatches[i + 1].index ?? seg.length) : seg.length;
      const piece = seg.slice(start, end).trim();
      if (piece) result.push(piece);
    }
  }
  return result;
}

// Table-format keyman: 접수자성함+접수자연락처 / 일반전화 / ★키맨성함·번호
function extractTableKeyman(rawText: string): string {
  const lines: string[] = [];

  // Use [\t ]+ instead of \s+ to stay within the same line (avoid swallowing newlines)
  const nameMatch = rawText.match(/접수자성함[\t ]+([^\n\t]+?)(?=[\t\n])/);
  const contactPhoneMatch = rawText.match(
    /접수자연락처[\t ]+(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );

  const name = nameMatch ? nameMatch[1].trim() : "";
  const phone = contactPhoneMatch ? contactPhoneMatch[1].trim() : "";

  if (name && phone) {
    lines.push(`${name} ${phone}`);
  } else if (phone) {
    lines.push(phone);
  } else if (name) {
    lines.push(name);
  }

  const landlineMatch = rawText.match(/일반전화\s+(0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/);
  if (landlineMatch) {
    lines.push(landlineMatch[1].trim());
  }

  // Quoted multi-line form: "010-... 이름\n010-..."
  const quotedKeymanMatch = rawText.match(/★?키맨성함\/번호\s*[\t ]+\s*"([\s\S]*?)"/);
  if (quotedKeymanMatch) {
    const inner = quotedKeymanMatch[1]
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    lines.push(...inner);
  } else {
    const keymanMatch = rawText.match(
      /★?키맨성함\/번호\s+([^\n\t]+?)(?=\s*(?:\n|\t|방문담당자|한조\/틴텍코드|주소|확장성|$))/
    );
    if (keymanMatch) {
      lines.push(keymanMatch[1].trim());
    }
  }

  if (lines.length === 0) {
    const fallback = extractPhonesWithContext(rawText);
    if (fallback) return fallback;
  }

  return lines.join("\n");
}

// One-line compact input decomposer — handles case where newlines were stripped.
// Uses landmarks (마감 keyword, first phone, first slash) to identify the 4 sections:
//   [grade+company+마감] [model/serial] [address] [phone(s)]
// Returns null if the input doesn't look like compact format or can't be confidently split.
function splitOneLineCompact(input: string): string[] | null {
  const closingKeywordMatch = input.match(
    /(분기마감|매월마감|매년마감|단순마감마감|단순마감|오픈\s*\d*시?반?)/
  );
  if (!closingKeywordMatch || closingKeywordMatch.index === undefined) return null;
  const sec1End = closingKeywordMatch.index + closingKeywordMatch[0].length;
  const sec1 = input.slice(0, sec1End);

  const rest = input.slice(sec1End);

  const phoneMatch = rest.match(/\d{2,3}-\d{3,4}-\d{4}/);
  if (!phoneMatch || phoneMatch.index === undefined) return null;
  const sec4Start = phoneMatch.index;
  const middle = rest.slice(0, sec4Start);
  const sec4 = rest.slice(sec4Start);

  // middle = [model/serial][address]. Must contain at least one '/'.
  const firstSlash = middle.indexOf("/");
  if (firstSlash < 0) return null;

  const after = middle.slice(firstSlash + 1);
  const addressStartRel = findAddressStart(after);
  if (addressStartRel < 0) return null;

  const serial = after.slice(0, addressStartRel).replace(/\s+$/, "");
  const address = after.slice(addressStartRel).trim();
  const sec2 = middle.slice(0, firstSlash) + "/" + serial;

  const sections = [sec1, sec2, address, sec4].map((s: string) => s.trim()).filter(Boolean);
  return sections.length >= 2 ? sections : null;
}

// Find where the address section begins within the "model/serial + address" blob.
// Picks the earliest plausible boundary from multiple hints:
//   - floor hint (\d+층 followed by space + 한글/괄호) — last 1-2 digits are the floor, rest is serial
//   - first 한글 character (serials don't contain 한글)
//   - opening parenthesis
//   - 지하/B+숫자+층
// Returns -1 if no boundary found.
function findAddressStart(after: string): number {
  const candidates: number[] = [];

  const floorMatch = after.match(/(\d+)층\s+[가-힣(]/);
  if (floorMatch && floorMatch.index !== undefined) {
    const digits = floorMatch[1];
    const floorLen = digits.length <= 2 ? digits.length : 1;
    candidates.push(floorMatch.index + (digits.length - floorLen));
  }

  const hangulMatch = after.match(/[가-힣]/);
  if (hangulMatch && hangulMatch.index !== undefined) {
    candidates.push(hangulMatch.index);
  }

  const parenMatch = after.match(/\(/);
  if (parenMatch && parenMatch.index !== undefined) {
    candidates.push(parenMatch.index);
  }

  const basementMatch = after.match(/지하\s*\d+층|B\d+층/);
  if (basementMatch && basementMatch.index !== undefined) {
    candidates.push(basementMatch.index);
  }

  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

// Split compact input block(s) — one block per 4-line group (company/model/address/phone)
function splitCompactBlocks(input: string): string[][] {
  const lines = input
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter(Boolean);

  // Single-line input with newlines stripped — try to decompose via landmarks
  if (lines.length === 1) {
    const decomposed = splitOneLineCompact(lines[0]);
    if (decomposed && decomposed.length >= 3) {
      return [decomposed];
    }
  }

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    // Grade-company header marks start of a new block
    const isGradeCompanyLine = /^\s*\d+(?:NN|SS|S|N|V)[^0-9]/.test(line);
    if (isGradeCompanyLine && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  return blocks.length > 0 ? blocks : [lines];
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 3: Samsung Note Titles (삼성노트 제목 생성)
// ────────────────────────────────────────────────────────────────────────────

const SEOUL_DISTRICTS = [
  "송파구", "강남구", "서초구", "용산구", "성동구", "노원구", "은평구",
  "마포구", "종로구", "광진구", "동작구", "관악구", "구로구",
  "영등포구", "금천구", "동대문구", "서대문구", "도봉구", "강동구",
  "강북구", "양천구", "성북구", "중랑구",
];

const BUSINESS_SUFFIXES = [
  "학원", "교회", "의원", "치과", "병원", "약국", "법인", "회사",
  "디자인", "피앤씨", "기획", "팩토리", "코리아", "메디칼", "메디컬",
  "코스메틱", "바이오", "안전", "사이언스", "엔터테인먼트", "컴퍼니",
  "인터내셔널", "그룹", "연구소", "협회", "재단", "스튜디오",
];

const COMPANY_STOP_PATTERN = new RegExp(
  [
    "㈜",
    "\\(주\\)",
    "주식회사",
    "\\d+층",
    "\\d+호",
    "\\d+동",
    "[A-Z]{2,}",
    "빌딩",
    "타워",
    "분기마감",
    "매월마감",
    "매년마감",
    "단순마감마감",
    "단순마감",
    "전일연락필수",
    "준전일연락필수",
    "진성완료",
    "현장종료",
    "오픈\\s*\\d*시?반?",
    ">",
    "-",
    "본사",
    ...SEOUL_DISTRICTS,
  ].join("|")
);

function splitScheduleBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const lines = input.split(/\r?\n/).map((line: string) => line.trimEnd());
  const blocks: string[][] = [];
  let current: string[] = [];
  let expectedNextNumber: number | null = null;

  lines.forEach((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^#/.test(trimmed) && current.length === 0) return;

    const numberMatch = trimmed.match(/^(\d+)\./);
    if (numberMatch) {
      const num = parseInt(numberMatch[1], 10);

      if (expectedNextNumber === null) {
        if (current.length > 0) blocks.push(current);
        current = [trimmed];
        expectedNextNumber = num + 1;
        return;
      }

      if (num === expectedNextNumber) {
        if (current.length > 0) blocks.push(current);
        current = [trimmed];
        expectedNextNumber = num + 1;
        return;
      }
      // Non-sequential number = internal list item, fall through to treat as content
    }

    if (current.length === 0) return;
    current.push(trimmed);
  });

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function extractLocationLabel(lines: string[]): string {
  const joined = lines.join(" ");
  const basementFloorMatch = joined.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basementFloorMatch) return basementFloorMatch[1].replace(/\s+/g, "");
  const hoMatch = joined.match(/(\d+호)/);
  if (hoMatch) return hoMatch[1];
  const floorDotMatch = joined.match(/(\d+[·.]\d+층)/);
  if (floorDotMatch) {
    const parts = floorDotMatch[1].match(/\d+/g);
    if (parts && parts.length > 0) return `${parts[parts.length - 1]}층`;
  }
  const floorMatch = joined.match(/(\d+층)/);
  if (floorMatch) return floorMatch[1];
  const dongMatch = joined.match(/(\d+동)/);
  if (dongMatch) return dongMatch[1];
  return "미기재";
}

function extractCompanyBySuffixWord(line: string): string {
  const alternation = BUSINESS_SUFFIXES.join("|");
  const pattern = new RegExp(
    `([가-힣A-Za-z0-9]{2,}(?:${alternation}))(?=[^가-힣A-Za-z0-9]|$)`,
    "g"
  );
  const matches = [...line.matchAll(pattern)];
  for (const m of matches) {
    const candidate = m[1].trim();
    if (candidate.length >= 3 && candidate.length <= 30) return candidate;
  }
  return "";
}

function applyCompanyStop(raw: string): string {
  let result = raw.replace(/\([^)]*\)/g, "").replace(/^\d+\.\s*/, "").trim();
  const stopMatch = result.match(COMPANY_STOP_PATTERN);
  if (stopMatch && typeof stopMatch.index === "number" && stopMatch.index > 0) {
    result = result.slice(0, stopMatch.index);
  }
  return result.trim();
}

const KOREA_REGION_PATTERN =
  "서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주";

function extractCompanyBeforeModel(line: string): string {
  const pattern = new RegExp(
    `([가-힣][가-힣A-Za-z0-9]{1,})\\s+[A-Z][A-Za-z0-9,-]{2,}(?:\\([^)]*\\))?\\s*\\/\\s*(?:${KOREA_REGION_PATTERN})`
  );
  const m = line.match(pattern);
  if (m) {
    const candidate = m[1].trim();
    if (candidate.length >= 2 && candidate.length <= 30) return candidate;
  }
  return "";
}

function extractTaskFromBody(lines: string[]): string {
  const pattern = new RegExp(
    `(?:^|\\s)([가-힣]{2,}[가-힣A-Za-z0-9]*)\\s+[가-힣][가-힣A-Za-z0-9]+\\s+[A-Z][A-Za-z0-9,-]{2,}(?:\\([^)]*\\))?\\s*\\/\\s*(?:${KOREA_REGION_PATTERN})`
  );
  for (let i = 1; i < lines.length; i += 1) {
    const m = lines[i].match(pattern);
    if (m) {
      const task = m[1].trim();
      if (task.length >= 2 && task.length <= 20) return task;
    }
  }
  return "";
}

function extractCompanyFromBodyLine(line: string): string {
  if (!line) return "";

  let raw = line.trim();
  raw = raw.replace(/^"/, "").replace(/"$/, "");

  // Suffix form: "XXX㈜", "XXX주식회사", "XXX(주)"
  const suffixMatch = raw.match(
    /(?:^|\s|")\d*(?:NN|SS|S|N|V)?\s*([가-힣][가-힣0-9]{1,})(?:㈜|주식회사|\(주\))/
  );
  if (suffixMatch) return suffixMatch[1].trim();

  // Prefix form: "주식회사 XXX" or "㈜XXX"
  let afterAnchor: string | null = null;
  const jushikMatch = raw.match(/주식회사\s+(.+)/);
  if (jushikMatch) {
    afterAnchor = jushikMatch[1];
  } else {
    const juMatch = raw.match(/㈜\s*([가-힣A-Za-z0-9].+)/);
    if (juMatch) afterAnchor = juMatch[1];
  }

  // Grade-prefix anchor: "14SS광운", "30N코리움사이언스"
  if (!afterAnchor) {
    const gradeMatch = raw.match(
      /(?:^|\s|")\d*(?:NN|SS|S|N|V)\s*([가-힣][^\s].*)/
    );
    if (gradeMatch) afterAnchor = gradeMatch[1];
  }

  if (afterAnchor) {
    const result = applyCompanyStop(afterAnchor);
    if (result && /[가-힣]{2,}/.test(result)) return result;
  }

  // Model-based: "[company] [MODEL] / [region]"
  const beforeModel = extractCompanyBeforeModel(raw);
  if (beforeModel) return beforeModel;

  // Final fallback: suffix-word pattern (학원, 교회, 의원...)
  const suffixWord = extractCompanyBySuffixWord(raw);
  if (suffixWord) return suffixWord;

  return "";
}

function extractCompanyFromBody(lines: string[]): string {
  for (let i = 1; i < lines.length; i += 1) {
    const company = extractCompanyFromBodyLine(lines[i]);
    if (company && /[가-힣]{2,}/.test(company) && company.length <= 30) {
      return company;
    }
  }
  return "";
}

function companyWordOverlap(candidate: string, bodyText: string): boolean {
  if (!candidate || !bodyText) return false;
  const words = candidate
    .split(/\s+/)
    .filter((w: string) => w.length >= 2 && /[가-힣A-Za-z]/.test(w));
  if (words.length === 0) return false;
  return words.some((w: string) => bodyText.includes(w));
}

function extractScheduleSummary(lines: string[], scheduleIndex: number): ResultItem {
  const firstLineRaw = (lines[0] || "").trim();
  const firstLineContent = firstLineRaw.replace(/^\d+\.\s*/, "").trim();

  const slashIdx = firstLineContent.indexOf("/");
  let candidateCompany = "";
  let summaryAfterSlash = "";
  if (slashIdx > 0) {
    candidateCompany = firstLineContent.slice(0, slashIdx).trim();
    summaryAfterSlash = firstLineContent.slice(slashIdx + 1).trim();
  }

  const bodyText = lines.slice(1).join(" ");
  const bodyCompany = extractCompanyFromBody(lines);

  let company: string;
  let summary: string;

  if (candidateCompany && companyWordOverlap(candidateCompany, bodyText)) {
    // First-line "X" matches body content — it's a real company identifier
    company = candidateCompany;
    summary = summaryAfterSlash || firstLineContent || "점검";
  } else if (bodyCompany) {
    company = bodyCompany;
    const bodyTask = firstLineContent ? "" : extractTaskFromBody(lines);
    summary = firstLineContent || bodyTask || "점검";
  } else if (candidateCompany) {
    // No body confirmation but first line has slash — still use it
    company = candidateCompany;
    summary = summaryAfterSlash || "점검";
  } else {
    company = "미기재";
    summary = firstLineContent || "점검";
  }

  const location = extractLocationLabel(lines);
  const content = `${scheduleIndex + 1}/${company} ${location}/${summary}`;

  const warnings: string[] = [];
  if (company === "미기재") warnings.push("업체명 추출 실패");
  if (location === "미기재") warnings.push("위치 추출 실패");

  return {
    content,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function transformSamsungNoteTitles(input: string): ResultItem[] {
  const blocks = splitScheduleBlocks(input);
  return blocks.map((lines: string[], index: number) => extractScheduleSummary(lines, index));
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 4: Blank Report (미양식 → 빈 보고서 양식 생성)
// ────────────────────────────────────────────────────────────────────────────

function splitParagraphBlocks(input: string): string[][] {
  if (!input || !input.trim()) return [];

  const normalized = input.trim();
  const explicitMultiBlocks = normalized
    .split(/\n\s*\n+/)
    .map((block: string) => block.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean))
    .filter((block: string[]) => block.length > 0);

  const hasNumberedSchedules = /^\d+\./m.test(normalized);
  const hasRepeatedTypeMarkers = (normalized.match(/(?:^|\n)(A\/S|여분요청|점검)\b/g) || []).length > 1;

  if (hasNumberedSchedules || hasRepeatedTypeMarkers) {
    return explicitMultiBlocks;
  }

  return [normalized.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean)];
}

function extractReportType(text: string): string {
  if (/여분요청/.test(text)) return "여분요청";
  if (/\bA\/S\b/.test(text)) return "A/S";
  return "점검";
}

function extractReportLevel(text: string, type: string): string {
  if (type === "점검") return "1";
  if (type === "A/S") {
    const match = text.match(/레벨\s*([123])/);
    return match ? match[1] : "";
  }
  return "";
}

function extractGrade(text: string): string {
  const tokenMatch = text.match(/(?:^|\s)(NN|SS|S|N|V)(?=\s|$)/);
  if (tokenMatch) return tokenMatch[1];
  const companyPrefixedMatch = text.match(/(?:^|\s)\d+(NN|SS|S|N|V)(?=[^A-Za-z0-9])/);
  if (companyPrefixedMatch) return companyPrefixedMatch[1];
  return "";
}

function extractCompanyForTemplate(text: string): string {
  const compact = text.replace(/\s+/g, " ");
  const quotedMatch = compact.match(
    /"\s*\d*(주식회사[^"]*?|법무법인[^"]*?|세무법인[^"]*?|[^"]*?(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))\s*(?:분기마감|매월마감|매년마감)/
  );
  if (quotedMatch) return quotedMatch[1].trim().replace(/-\s*$/, "");

  const companyAfterGradeMatch = compact.match(
    /(?:^|\s)\d+(NN|SS|S|N|V)([^\n]*?)(분기마감|매월마감|매년마감|오픈\s*\d*시?반?분기마감|오픈\s*\d*시?반?|단순마감마감|단순마감)/
  );
  if (companyAfterGradeMatch) {
    return companyAfterGradeMatch[2]
      .replace(/^\s*"/, "")
      .replace(/"\s*$/, "")
      .trim()
      .replace(/-\s*$/, "");
  }

  const fallback = compact.match(
    /(법무법인\s*[가-힣A-Za-z0-9\s]+|세무법인\s*[가-힣A-Za-z0-9\s]+|주식회사\s*[가-힣A-Za-z0-9\s]+|㈜\s*[가-힣A-Za-z0-9\s]+|[가-힣A-Za-z0-9\s]+(?:의원|치과|회사|교회|법인|디자인|피앤씨|기획|팩토리|택스))/
  );
  return fallback ? fallback[1].trim().replace(/-\s*$/, "") : "";
}

function extractDepartment(text: string): string {
  // Basement floors (지하1층, 지하 1층, B1층) take priority — must be checked
  // before the general \d+층 pattern which would only grab the trailing digit
  const basementMatch = text.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basementMatch) return basementMatch[1].replace(/\s+/g, "");

  // Prefer whitespace-anchored 1-2 digit floor: " 7층", " 11층"
  const spacedFloorMatch = text.match(/(?:^|\s)(\d{1,2})층/);
  if (spacedFloorMatch) return `${spacedFloorMatch[1]}층`;

  // Merged form like "107층" → typically building# + floor → take trailing digit
  const mergedFloorMatch = text.match(/(\d+)층/);
  if (mergedFloorMatch) {
    const num = mergedFloorMatch[1];
    if (num.length <= 2) return `${num}층`;
    return `${num.slice(-1)}층`;
  }

  const hoMatch = text.match(/(\d+호)/);
  if (hoMatch) return hoMatch[1];
  const suiteMatch = text.match(/상가\s*(\d+호)/);
  if (suiteMatch) return suiteMatch[1];
  return "";
}

function extractPhonesWithContext(text: string): string {
  const contactNameMatch = text.match(
    /접수자성함\s*([^\n]+?)\s+접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactNameMatch) return `${contactNameMatch[1].trim()} ${contactNameMatch[2].trim()}`;

  const contactPhoneOnlyMatch = text.match(
    /접수자연락처\s*(01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/
  );
  if (contactPhoneOnlyMatch) return contactPhoneOnlyMatch[1].trim();

  const genericContactBlockMatch = text.match(/연락처\s+(01\d[- ]?\d{3,4}[- ]?\d{4})\s*([^\n]*)/);
  if (genericContactBlockMatch) {
    const phone = genericContactBlockMatch[1].trim();
    const name = (genericContactBlockMatch[2] || "").trim();
    return name ? `${phone} ${name}` : phone;
  }

  return "";
}

function extractModelAndSerial(text: string): ModelSerial {
  const modelMatch = text.match(
    /기종\s+((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-|[A-Za-z가-힣0-9][A-Za-z가-힣0-9._-]{1,})[^\s\n]*)/i
  );
  const serialMatch = text.match(/(?:기번|시리얼넘버)\s+([A-Z0-9-]+)/i);
  if (modelMatch || serialMatch) {
    return {
      model: modelMatch ? modelMatch[1].trim() : "",
      serial: serialMatch ? serialMatch[1].trim() : "",
    };
  }

  const slashMatch = text.match(
    /((?:ApeosPort|Apeos|ECOSYS|SL-|DocuCentre|DocuPrint|bizhub|IR-|TASKalfa|MX-|HP-|MFC-)[^/\n\s]*)\s*\/\s*([A-Z0-9-]+)/i
  );
  if (slashMatch) return { model: slashMatch[1].trim(), serial: slashMatch[2].trim() };

  const genericSlashLineMatch = text.match(
    /(?:^|\n|\s)(?!한조\/틴텍코드)([A-Za-z가-힣][A-Za-z가-힣0-9._-]{1,})\s*\/\s*([A-Z0-9-]{6,})(?=\s|$)/
  );
  if (genericSlashLineMatch) {
    return { model: genericSlashLineMatch[1].trim(), serial: genericSlashLineMatch[2].trim() };
  }

  return { model: "", serial: "" };
}

function extractAssetNumber(text: string): string {
  const match = text.match(/자산번호\s+([A-Z]\d+)/i);
  return match ? match[1].trim() : "";
}

function extractStatusText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const quotedStatusMatch = normalized.match(
    /(?:^|\s)상태\s+"\s*([\s\S]*?)\s*"(?=\s+(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  if (quotedStatusMatch) return quotedStatusMatch[1].trim();
  const plainStatusMatch = normalized.match(
    /(?:^|\s)상태\s+(.*?)(?=\s+(?:제목|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  if (plainStatusMatch) return plainStatusMatch[1].trim();
  return "";
}

function extractTitleText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const titleMatch = normalized.match(
    /제목\s+(.*?)(?=\s+(?:상태|참고사항|기종|기기상태|AS접수횟수|방문담당자|주소)|\s*$)/
  );
  return titleMatch ? titleMatch[1].trim() : "";
}

function extractTemplateContent(text: string, type: string): string {
  if (type === "여분요청") return extractStatusText(text) || extractTitleText(text) || "";
  if (type === "A/S") return extractStatusText(text) || extractTitleText(text) || "";
  return "정기점검";
}

function extractTemplateProcessContent(_text: string, type: string): string {
  if (type === "점검") return "정기점검";
  return "";
}

type PrinterReportFields = {
  type: string;
  level: string;
  grade: string;
  company: string;
  department: string;
  region: string;
  keyman: string;
  model: string;
  serial: string;
  assetNumber: string;
  content: string;
  processContent: string;
};

function formatPrinterReport(f: PrinterReportFields): string {
  return [
    "작성자:",
    `구분:${f.type}`,
    `레벨:${f.level}`,
    `등급:${f.grade}`,
    `업체명:${f.company}`,
    `부서명:${f.department}`,
    `지역:${f.region}`,
    `키맨/접수자:${f.keyman}`,
    ITEM_DIVIDER,
    "1.",
    `모델명:${f.model}`,
    `시리얼넘버:${f.serial}`,
    `자산기번: ${f.assetNumber}`,
    `내용: ${f.content}`,
    `처리내용:${f.processContent ? ` ${f.processContent}` : ""}`,
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분:  K- C- M- Y- 폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    "특이사항:",
    SECTION_DIVIDER,
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    SECTION_DIVIDER,
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    ITEM_DIVIDER,
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}

function buildBlankReportCompact(blockLines: string[]): ResultItem {
  const gradeCompanyLine = blockLines[0] || "";
  const modelSerialLine = blockLines[1] || "";
  const addressLine = blockLines[2] || "";
  const phoneLines = blockLines.slice(3);

  const grade = extractGrade(gradeCompanyLine);
  const company = extractCompactCompany(gradeCompanyLine);
  const { model, serial } = parseCompactModelSerial(modelSerialLine);
  const department = extractDepartment(addressLine);
  const keymanSegments = phoneLines.flatMap((l: string) => splitPhoneLine(l));
  const keyman = keymanSegments.join("\n");

  const body = formatPrinterReport({
    type: "점검",
    level: "1",
    grade,
    company,
    department,
    region: "C",
    keyman,
    model,
    serial,
    assetNumber: "",
    content: "정기점검",
    processContent: "정기점검",
  });

  const warnings: string[] = [];
  if (!company) warnings.push("업체명 추출 실패");
  if (!model && !serial) warnings.push("모델/시리얼 추출 실패");
  if (!keyman) warnings.push("연락처 추출 실패");

  return {
    content: body,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function buildBlankReport(blockLines: string[]): ResultItem {
  const rawText = blockLines.join("\n");
  const flatText = blockLines.join(" ");
  const format = detectInputFormat(rawText);

  // Type: table format prefers 접수분야 field (handles 샘플전달, 점검, A/S, 여분요청...)
  const tableType = format === "table" ? extractTableReportType(rawText) : "";
  const type = tableType || extractReportType(flatText);

  const level = extractReportLevel(flatText, type);
  const grade = extractGrade(flatText);
  const company =
    format === "table" ? extractTableCompany(rawText) : extractCompanyForTemplate(flatText);
  const department = extractDepartment(flatText);
  const keyman =
    format === "table" ? extractTableKeyman(rawText) : extractPhonesWithContext(flatText);
  const ms: ModelSerial = (() => {
    if (format === "table") {
      const table = extractTableModelSerial(rawText);
      const fallback = extractModelAndSerial(flatText);
      return {
        model: table.model || fallback.model,
        serial: table.serial || fallback.serial,
      };
    }
    return extractModelAndSerial(flatText);
  })();
  const assetNumber = extractAssetNumber(flatText);

  // Region: table format reads 방문담당자 (수도권A/B/C/D/E), defaults to C
  const region = format === "table" ? extractTableRegion(rawText) || "C" : "C";

  // Content: table format prefers 상태 field (multi-line, quote-stripped).
  // If 상태 has a value, use it and leave 처리내용 blank; otherwise fall back to defaults.
  let content: string;
  let processContent: string;
  if (format === "table") {
    const status = extractStatusTextFromRaw(rawText);
    if (status) {
      content = status;
      processContent = "";
    } else {
      content = extractTemplateContent(flatText, type);
      processContent = extractTemplateProcessContent(flatText, type);
    }
  } else {
    content = extractTemplateContent(flatText, type);
    processContent = extractTemplateProcessContent(flatText, type);
  }

  const body = formatPrinterReport({
    type,
    level,
    grade,
    company,
    department,
    region,
    keyman,
    model: ms.model,
    serial: ms.serial,
    assetNumber,
    content,
    processContent,
  });

  const warnings: string[] = [];
  if (!company) warnings.push("업체명 추출 실패");
  if (!ms.model && !ms.serial) warnings.push("모델/시리얼 추출 실패");
  if (!keyman) warnings.push("연락처 추출 실패");

  return {
    content: body,
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
  };
}

function transformBlankReports(input: string): ResultItem[] {
  if (!input || !input.trim()) return [];

  const format = detectInputFormat(input);
  if (format === "compact") {
    const blocks = splitCompactBlocks(input);
    return blocks.map((block: string[]) => buildBlankReportCompact(block));
  }

  const blocks = splitParagraphBlocks(input);
  return blocks.map((block: string[]) => buildBlankReport(block));
}

// ────────────────────────────────────────────────────────────────────────────
// Clipboard utilities
// ────────────────────────────────────────────────────────────────────────────

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

async function copyTextToClipboard(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, message: "복사할 내용이 없습니다." };

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, message: "복사 완료" };
    } catch {
      const fallbackSucceeded = copyTextFallback(text);
      if (fallbackSucceeded) return { ok: true, message: "복사 완료" };
      return { ok: false, message: "복사가 차단되었습니다. 직접 선택해 복사해 주세요." };
    }
  }

  const fallbackSucceeded = copyTextFallback(text);
  if (fallbackSucceeded) return { ok: true, message: "복사 완료" };
  return { ok: false, message: "복사가 차단되었습니다. 직접 선택해 복사해 주세요." };
}

async function pasteFromClipboard(): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests (DEV only)
// ────────────────────────────────────────────────────────────────────────────

const TEST_CASES: TestCase[] = [
  {
    name: "업체명 여러 줄 유지",
    input: "업체명: 주식회사 필립오토서비스\n부가설명 한 줄 더\n부서명: 303호\n-------------------------------------",
    expected: "부가설명 한 줄 더",
    mode: "inspection",
  },
  {
    name: "주차비지원유무 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n주차비지원유무 : 주차하려했으나 발렛 5천원\n다음 방문시 공용주차 요청\n특이사항: 테스트",
    expected: "다음 방문시 공용주차 요청",
    mode: "inspection",
  },
  {
    name: "특이사항 여러 줄 유지",
    input: "-------------------------------------\n모델명: ECOSYS\n특이사항: 첫줄\n둘째줄\n셋째줄",
    expected: "셋째줄",
    mode: "inspection",
  },
  {
    name: "위치 제목 자동 번호 부여",
    input: "-------------------------------------\n15층입구\n모델명: D470\n시리얼넘버: 809150608947",
    expected: "1. 15층입구",
    mode: "inspection",
  },
  {
    name: "청정기 필터리셋 필드 유지",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n자산기번: X7505\n내용: 정기점검\n처리내용: 필터 청소\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    expected: "필터리셋:유",
    mode: "air-purifier",
  },
  {
    name: "청정기 필터교체 필드 유지",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n자산기번: X7505\n내용: 정기점검\n처리내용: 필터 청소\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    expected: "필터교체:무",
    mode: "air-purifier",
  },
  {
    name: "청정기 매수/토너 필드 제외",
    input: "구분:점검\n등급:S\n업체명:업체A\n부서명:7층\n지역:C\n키맨/접수자:010-0000-0000\n_____________________________\n1.\n모델명:샤오미 MI-AIR\n시리얼넘버:318115/00036240\n필터리셋:유\n필터교체:무\n특이사항: 없음",
    mode: "air-purifier",
    expected: "※부품신청※",
  },
  {
    name: "삼성노트 업체명 추출 실패 경고",
    input: "1.점검\n알수없는텍스트\n010-1234-5678",
    expected: "미기재",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 첫줄 X/Y + 바디 매칭 (올리브인터내셔널)",
    input: "1.올리브인터내셔널/모니터 전달\nAS    SS   PC모니터  비용 180,000원 안내완료   주식회사 올리브인터내셔널 AK빌딩 4층\n자산번호   S0378   시리얼번호\n접수자성함연락처   김종현 담당자님 010-7456-5416\n서울 강남구 논현로79길 12 (역삼동) AK빌딩 4층 (엘베 유)",
    expected: "1/올리브인터내셔널 4층/모니터 전달",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 내부 번호리스트 제외 (알스퀘어)",
    input: "2.알스퀘어 신한리츠운용/랜선2개\n5.알스퀘어디자인-신한리츠운용 그레이츠강남\n6. 성함 : 천명규 책임 / 010-6210-8679\n7. 주소(엘리베이터 유무) :서울 서초구 서초동 1321-11 그레이츠강남 1층",
    expected: "1/알스퀘어 신한리츠운용 1층/랜선2개",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 첫줄 슬래시는 태스크 (블레이드)",
    input: "3.블레이드/k드럼 분해PM\nA/S N ECOSYS-MA2100CFX \"4N주식회사 그리드엔터테인먼트-전 주식회사 일삼일 /\n기번   WDM4302486   자산번호   B7749\n접수자성함   서유나\n접수자연락처   010-5018-0906\n주소   서울 강남구 논현로155길 31   확장성",
    expected: "1/그리드엔터테인먼트 미기재/블레이드/k드럼 분해PM",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 구(區) 표기 정리 (광운)",
    input: "4.1대\n14SS주식회사 광운송파구 > 강남구분기마감\nD450/800140653219\n서울 강남구 도산대로 159\n춘곡빌딩 (춘곡빌딩, 서울 강남구 신사동 561-30)",
    expected: "1/광운 미기재/1대",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 빈 첫줄은 점검 (팬틱스)",
    input: "5.\n4NN주식회사 팬틱스-전 주식회사 컨셉케이컴퍼니분기마감\nApeosPort-C2060/513194\n서울 강남구 도산대로12길 25-1\n2층 엘베o 엘베는 3층(특이사항: 엘리베이터는 3층으로 내려야함) (서울 강남구 논현동 11-19)\n010-9119-3335 대표님 김수민 010-4893-3286(결제 키)",
    expected: "1/팬틱스 2층/점검",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 ㈜ 접미형 (신우개발)",
    input: "6.9대\n25V신우개발㈜3층 매월마감\nAPEOS-C5570/175219\n서울 서초구 바우뫼로 198\n- (신우빌딩, 서울 서초구 양재동 82-7)",
    expected: "1/신우개발 3층/9대",
    mode: "samsung-note",
  },
  {
    name: "삼성노트 6건 일괄 처리 순차 번호",
    input: "1.올리브인터내셔널/모니터 전달\n주식회사 올리브인터내셔널 AK빌딩 4층\n2.알스퀘어 신한리츠운용/랜선2개\n5.알스퀘어디자인-신한리츠운용 그레이츠강남\n7. 주소 서울 서초구 1층\n3.블레이드/k드럼 분해PM\nN ECOSYS \"4N주식회사 그리드엔터테인먼트-전 주식회사\n4.1대\n14SS주식회사 광운송파구 > 강남구분기마감\n5.\n4NN주식회사 팬틱스-전 주식회사 분기마감\n2층\n6.9대\n25V신우개발㈜3층",
    expected: "6/신우개발 3층/9대",
    mode: "samsung-note",
  },
  {
    name: "청정기 compact 입력 - 등급/업체명/부서명",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층 프리즘산업 (프리즘빌딩, 서울 강남구 역삼동 736-35)\n010-9312-7412 이영선/010-9312-7412 이영선",
    expected: "업체명: 프리즘산업",
    mode: "air-purifier",
  },
  {
    name: "청정기 compact 입력 - 부서명 107층 → 7층",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층 프리즘산업\n010-9312-7412 이영선",
    expected: "부서명: 7층",
    mode: "air-purifier",
  },
  {
    name: "청정기 compact 입력 - 모델/시리얼 슬래시 분리",
    input:
      "17S㈜프리즘산업-매월마감\n샤오미 MI-AIR/318115/00036240\n서울 강남구 테헤란로22길 107층\n010-9312-7412 이영선",
    expected: "시리얼넘버: 318115/00036240",
    mode: "air-purifier",
  },
  {
    name: "미양식 compact 입력 - 주식회사 유지",
    input:
      "31SS주식회사 에이피더핀(AP The Fin Inc)중앙쪽매월마감\nECOSYS-M5521CDN/VUY2Z03481\n서울 강남구 테헤란로 218에이피타워 11층 (AP Tower)\n010-6822-9591/070-4850-8726 이수민선임 010-8131-1966 이세희선임(경영지원)",
    expected: "업체명:주식회사 에이피더핀(AP The Fin Inc)중앙쪽",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 입력 - 키맨 여러 전화번호 분리",
    input:
      "31SS주식회사 에이피더핀매월마감\nECOSYS-M5521CDN/VUY2Z03481\n서울 강남구 11층\n010-6822-9591/070-4850-8726 이수민선임 010-8131-1966 이세희선임(경영지원)",
    expected: "010-8131-1966 이세희선임(경영지원)",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 업체명 여러 줄 유지",
    input:
      'A/S\tV\tApeosPort-VI C3371(베니)\t"19V엔티에스케이투\nK2 성수 2층 CS팀-문서용매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n일반전화\t02-3408-8507\n★키맨성함/번호\t양명호 차장 010-6314-7409\n기종\tApeosPort-VI C3371(베니)\t기기상태\t확인요망\n상태\t출력시 묻어나옴',
    expected: "K2 성수 2층 CS팀-문서용",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 모델명 전체 추출",
    input:
      'A/S\tV\tApeosPort-VI C3371(베니)\t"19V엔티에스케이투\nK2 성수 2층 CS팀-문서용매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686\n기종\tApeosPort-VI C3371(베니)\t기기상태\t확인요망',
    expected: "모델명:ApeosPort-VI C3371(베니)",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 시리얼 인용구 내부 추출",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\t"665941\nIP-211-63-14-146"\t자산번호\tC3686',
    expected: "시리얼넘버:665941",
    mode: "blank-report",
  },
  {
    name: "미양식 table 입력 - 키맨 3줄 (접수자/일반/★키맨)",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n일반전화\t02-3408-8507\n★키맨성함/번호\t양명호 차장 010-6314-7409',
    expected: "02-3408-8507",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 내용이 참고사항까지 넘치지 않음",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t양명호\n접수자연락처\t010-6314-7409\n제목\t출력시 묻어나옴\n상태\t출력시 묻어나옴\n참고사항\t" [AS 히스토리 요약]\n📊 총 접수 건수: 3건\n✅ 특이사항 없음"',
    expected: "내용: 출력시 묻어나옴\n처리내용:",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 접수분야가 샘플전달이면 구분도 샘플전달",
    input:
      '샘플전달\tN\tES5473\t"15N브루니아단순마감"\n접수유형\t전화\t접수분야\t샘플전달\n기번\tAK96006517',
    expected: "구분:샘플전달",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 점검 타입이어도 상태값 있으면 내용에 사용",
    input:
      '점검\tN\t모델\t"19N회사단순마감"\n기번\tXYZ123\t자산번호\tA1\n접수유형\t카카오\t접수분야\t점검\n상태\t실제 문제 증상\n참고사항\t" 뭐라뭐라 "',
    expected: "내용: 실제 문제 증상\n처리내용:",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 키맨 따옴표 다중라인 (분리)",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n접수자성함\t\n접수자연락처\t010-1111-2222\n★키맨성함/번호\t"010-3333-4444 대표님\n010-5555-6666"\n방문담당자\t수도권C',
    expected: "010-5555-6666",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 업체명 끝 ㈜ 제거",
    input:
      "점검    N   MFC-L5700DN   19N동영공예품㈜-단순마감마감\n접수분야   점검\n기번   E7671",
    expected: "업체명:동영공예품",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 수도권A → 지역:A",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222\n방문담당자\t수도권A',
    expected: "지역:A",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 수도권E → 지역:E",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222\n방문담당자\t수도권E',
    expected: "지역:E",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 방문담당자 없으면 기본 지역:C",
    input:
      'A/S\tV\t모델\t"19V회사매월마감"\n기번\tXYZ\t자산번호\tA1\n접수자연락처\t010-1111-2222',
    expected: "지역:C",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 한 줄 입력 - 시리얼 끝 자리 누락 안됨",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업 (프리즘빌딩, 서울 강남구 역삼동 736-35)010-9312-7412 이영선/",
    expected: "시리얼넘버:318115/00036240",
    mode: "blank-report",
  },
  {
    name: "미양식 compact 한 줄 입력 - 부서명 정상 추출",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업010-9312-7412 이영선",
    expected: "부서명:7층",
    mode: "blank-report",
  },
  {
    name: "청정기 compact 한 줄 입력 - 모델/시리얼 분리",
    input:
      "17S㈜프리즘산업-매월마감샤오미 MI-AIR/318115/000362407층 프리즘산업010-9312-7412 이영선",
    expected: "시리얼넘버: 318115/00036240",
    mode: "air-purifier",
  },
  {
    name: "compact 한 줄 입력 - 2자리 층 (AP The Fin)",
    input:
      "31SS주식회사 에이피더핀매월마감ECOSYS-M5521CDN/VUY2Z03481서울 강남구 테헤란로 218에이피타워 11층 (AP Tower)010-6822-9591",
    expected: "부서명:11층",
    mode: "blank-report",
  },
  {
    name: "미양식 table - 지하1층 주소 (지하1층으로 추출)",
    input:
      'A/S\tV\t모델\t"19V회사단순마감"\n기번\tX1\t자산번호\tA1\n접수자연락처\t010-1111-2222\n주소\t서울 성북구 종암로36길 52, 하월곡아남아파트 102동 9호10호 지하 1층 관리사무소',
    expected: "부서명:지하1층",
    mode: "blank-report",
  },
  {
    name: "미양식 table - B1층 패턴도 지하층으로 인식",
    input:
      'A/S\tV\t모델\t"19V회사단순마감"\n기번\tX1\t자산번호\tA1\n접수자연락처\t010-1111-2222\n주소\t서울 강남구 테헤란로 123 B1층 기계실',
    expected: "부서명:B1층",
    mode: "blank-report",
  },
  {
    name: "복사 함수 준비",
    input: "noop",
    expectedFunction: true,
    mode: "shared",
  },
];

function runSelfTests(): TestResult[] {
  return TEST_CASES.map((test: TestCase) => {
    if (test.expectedFunction) {
      const passed = typeof copyTextToClipboard === "function" && typeof copyTextFallback === "function";
      return { ...test, passed, actual: passed ? "function ready" : "missing function" };
    }

    let actual = "";
    if (test.mode === "samsung-note") {
      actual = transformSamsungNoteTitles(test.input).map((r: ResultItem) => r.content).join("\n");
    } else if (test.mode === "blank-report") {
      actual = transformBlankReports(test.input).map((r: ResultItem) => r.content).join("\n");
    } else if (test.mode === "air-purifier") {
      actual = transformAirPurifierText(test.input);
    } else {
      actual = transformInspectionText(test.input);
    }

    return {
      ...test,
      passed: typeof test.expected === "string" ? actual.includes(test.expected) : false,
      actual,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Processing form (미양식 mode) — manual entry for printer service details
// ────────────────────────────────────────────────────────────────────────────

type PerItemForm = {
  processContent: string;
  mailBlack: string;
  mailColor: string;
  mailLargeColor: string;
  mailTotal: string;
  tonerK: string;
  tonerC: string;
  tonerM: string;
  tonerY: string;
  waste: string;
  spareK: string;
  spareC: string;
  spareM: string;
  spareY: string;
  spareWaste: string;
  hantin: string;
  parkingChip: string;
  parkingCustom: string;
  notes: string;
};

const EMPTY_ITEM_FORM: PerItemForm = {
  processContent: "",
  mailBlack: "", mailColor: "", mailLargeColor: "", mailTotal: "",
  tonerK: "", tonerC: "", tonerM: "", tonerY: "",
  waste: "",
  spareK: "", spareC: "", spareM: "", spareY: "", spareWaste: "",
  hantin: "",
  parkingChip: "", parkingCustom: "",
  notes: "",
};

type SharedForm = {
  level: string;
  warranty: string;
  cumCount: string;
  expectedCount: string;
  partName: string;
  partQty: string;
  partShipped: string;
  selfItem: string;
  selfQty: string;
  selfShipped: string;
  arrivalHour: string;
  arrivalMinute: string;
  duration: string;
};

const EMPTY_SHARED_FORM: SharedForm = {
  level: "",
  warranty: "", cumCount: "", expectedCount: "",
  partName: "", partQty: "", partShipped: "",
  selfItem: "", selfQty: "", selfShipped: "",
  arrivalHour: "", arrivalMinute: "", duration: "",
};

type AirPurifierForm = {
  filterReset: string;
  filterChange: string;
  notes: string;
  arrivalHour: string;
  arrivalMinute: string;
  duration: string;
};

const EMPTY_AIR_FORM: AirPurifierForm = {
  filterReset: "",
  filterChange: "",
  notes: "",
  arrivalHour: "",
  arrivalMinute: "",
  duration: "",
};

function suffixIfValue(label: string, v: string): string {
  return v.trim() ? `${label} ${v.trim()}` : label;
}

function normToken(s: string): string {
  return s === "-" ? "" : s;
}

function dashIfEmpty(s: string): string {
  return s.trim() ? s.trim() : "-";
}

// Parses an existing "매수:흑X 컬X 큰컬X 합X" line into its 4 values
function parseMail(line: string): { black: string; color: string; largeColor: string; total: string } {
  const m = line.match(/^매수\s*:\s*흑(\S*)\s*컬(\S*)\s*큰컬(\S*)\s*합(\S*)/);
  if (!m) return { black: "", color: "", largeColor: "", total: "" };
  return { black: normToken(m[1]), color: normToken(m[2]), largeColor: normToken(m[3]), total: normToken(m[4]) };
}

function parseToner(line: string): { K: string; C: string; M: string; Y: string } {
  const m = line.match(/^토너잔량\s*:\s*K(\S*)\s+C(\S*)\s+M(\S*)\s+Y(\S*)/);
  if (!m) return { K: "", C: "", M: "", Y: "" };
  return { K: normToken(m[1]), C: normToken(m[2]), M: normToken(m[3]), Y: normToken(m[4]) };
}

function parseWaste(line: string): string {
  const m = line.match(/^폐통\s*:\s*(\S*?)\s*%/);
  return m ? normToken(m[1]) : "";
}

function parseSpare(line: string): { K: string; C: string; M: string; Y: string; waste: string } {
  const m = line.match(/^여분\s*:\s*K(\S*)\s+C(\S*)\s+M(\S*)\s+Y(\S*)\s+폐(\S*)/);
  if (!m) return { K: "", C: "", M: "", Y: "", waste: "" };
  return { K: normToken(m[1]), C: normToken(m[2]), M: normToken(m[3]), Y: normToken(m[4]), waste: normToken(m[5]) };
}

function parseValueAfterColon(line: string, label: string): string {
  const re = new RegExp(`^${label}\\s*:\\s*(.*)$`);
  const m = line.match(re);
  return m ? m[1].trim() : "";
}

function mergeMailLine(line: string, f: PerItemForm): string {
  const p = parseMail(line);
  const black = f.mailBlack.trim() || p.black;
  const color = f.mailColor.trim() || p.color;
  const large = f.mailLargeColor.trim() || p.largeColor;
  const total = f.mailTotal.trim() || p.total;
  return `매수:흑${dashIfEmpty(black)} 컬${dashIfEmpty(color)} 큰컬${dashIfEmpty(large)} 합${dashIfEmpty(total)}`;
}

function mergeTonerLine(line: string, f: PerItemForm): string {
  const p = parseToner(line);
  const K = f.tonerK.trim() || p.K;
  const C = f.tonerC.trim() || p.C;
  const M = f.tonerM.trim() || p.M;
  const Y = f.tonerY.trim() || p.Y;
  return `토너잔량:K${dashIfEmpty(K)} C${dashIfEmpty(C)} M${dashIfEmpty(M)} Y${dashIfEmpty(Y)}`;
}

function mergeWasteLine(line: string, f: PerItemForm): string {
  const value = f.waste.trim() || parseWaste(line);
  return value ? `폐통: ${value}%` : "폐통:  %";
}

function mergeSpareLine(line: string, f: PerItemForm): string {
  const p = parseSpare(line);
  const K = f.spareK.trim() || p.K;
  const C = f.spareC.trim() || p.C;
  const M = f.spareM.trim() || p.M;
  const Y = f.spareY.trim() || p.Y;
  const waste = f.spareWaste.trim() || p.waste;
  return `여분:  K${dashIfEmpty(K)} C${dashIfEmpty(C)} M${dashIfEmpty(M)} Y${dashIfEmpty(Y)} 폐${dashIfEmpty(waste)}`;
}

function applyProcessingFormV2(
  text: string,
  itemForms: PerItemForm[],
  shared: SharedForm,
  author: string
): string {
  let itemIdx = -1;
  let section: "" | "parts" | "self" = "";

  return text.split("\n").map((line: string) => {
    if (/^\s*\d+\./.test(line) && !/※/.test(line)) {
      itemIdx++;
      section = "";
      return line;
    }
    if (/^※부품신청※/.test(line)) { section = "parts"; return line; }
    if (/^※자가신청※/.test(line)) { section = "self"; return line; }

    // Header (shared)
    if (/^작성자\s*:/.test(line)) {
      return author.trim() ? line.replace(/^(작성자\s*:\s*).*/, `$1${author.trim()}`) : line;
    }
    if (/^레벨\s*:/.test(line)) {
      return shared.level.trim() ? line.replace(/^(레벨\s*:\s*).*/, `$1${shared.level.trim()}`) : line;
    }

    // Per-item fields
    if (itemIdx >= 0 && itemIdx < itemForms.length) {
      const f = itemForms[itemIdx];
      if (/^처리내용\s*:/.test(line)) {
        return f.processContent.trim() ? `처리내용: ${f.processContent.trim()}` : line;
      }
      if (/^매수\s*:/.test(line)) return mergeMailLine(line, f);
      if (/^토너잔량\s*:/.test(line)) return mergeTonerLine(line, f);
      if (/^폐통\s*:/.test(line)) return mergeWasteLine(line, f);
      if (/^여분\s*:/.test(line)) return mergeSpareLine(line, f);
      if (/^한틴이카유무\s*:/.test(line)) {
        const existing = parseValueAfterColon(line, "한틴이카유무");
        const v = f.hantin.trim() || existing;
        return suffixIfValue("한틴이카유무:", v);
      }
      if (/^주차비지원유무\s*:/.test(line)) {
        const existing = parseValueAfterColon(line, "주차비지원유무");
        const parkingValue = f.parkingCustom.trim() || f.parkingChip || existing;
        return suffixIfValue("주차비지원유무:", parkingValue);
      }
      if (/^특이사항\s*:/.test(line)) {
        const existing = parseValueAfterColon(line, "특이사항");
        const v = f.notes.trim() || existing;
        return suffixIfValue("특이사항:", v);
      }
    }

    // Parts / self / footer (shared)
    if (/^보증기간 내 여부\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "보증기간 내 여부");
      const v = shared.warranty.trim() || existing;
      return v ? `보증기간 내 여부 : ${v}` : "보증기간 내 여부 :";
    }
    if (/^교체 전 카운터 누적 사용매수\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "교체 전 카운터 누적 사용매수");
      const v = shared.cumCount.trim() || existing;
      return v ? `교체 전 카운터 누적 사용매수 : ${v}` : "교체 전 카운터 누적 사용매수 :";
    }
    if (/^사용 부품 예상 사용매수\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "사용 부품 예상 사용매수");
      const v = shared.expectedCount.trim() || existing;
      return v ? `사용 부품 예상 사용매수 : ${v}` : "사용 부품 예상 사용매수 :";
    }
    if (/^물품명\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "물품명");
      const v = shared.partName.trim() || existing;
      return suffixIfValue("물품명:", v);
    }
    if (/^물품\s*:/.test(line) && section === "self") {
      const existing = parseValueAfterColon(line, "물품");
      const v = shared.selfItem.trim() || existing;
      return suffixIfValue("물품:", v);
    }
    if (/^수량\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "수량");
      const v = (section === "self" ? shared.selfQty.trim() : shared.partQty.trim()) || existing;
      return suffixIfValue("수량:", v);
    }
    if (/^출고여부\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "출고여부");
      const v = (section === "self" ? shared.selfShipped.trim() : shared.partShipped.trim()) || existing;
      return suffixIfValue("출고여부:", v);
    }
    if (/^도착 시간\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "도착 시간");
      const arrival = shared.arrivalHour
        ? `${shared.arrivalHour}:${shared.arrivalMinute || "00"}`
        : existing;
      return suffixIfValue("도착 시간:", arrival);
    }
    if (/^소요 시간\s*:/.test(line)) {
      const existing = parseValueAfterColon(line, "소요 시간");
      const v = shared.duration.trim() ? `${shared.duration.trim()}분` : existing;
      return suffixIfValue("소요 시간:", v);
    }
    return line;
  }).join("\n");
}

function countInspectionItems(text: string): number {
  if (!text) return 0;
  return text.split("\n").filter((l: string) => /^\s*\d+\./.test(l)).length;
}

function extractInspectionItemLabels(text: string): string[] {
  if (!text) return [];
  const labels: string[] = [];
  let idx = -1;
  let model = "";
  let serial = "";
  let asset = "";

  const flush = () => {
    if (idx < 0) return;
    const parts = [model, serial, asset].map((p: string) => p.trim()).filter((p: string) => p);
    labels.push(`${idx + 1}. ${parts.length ? parts.join("/") : "(미상)"}`);
  };

  for (const line of text.split("\n")) {
    if (/^\s*\d+\./.test(line)) {
      flush();
      idx++;
      model = serial = asset = "";
      continue;
    }
    const mm = line.match(/^모델명\s*:\s*(.*)$/);
    if (mm) { model = mm[1]; continue; }
    const ms = line.match(/^시리얼넘버\s*:\s*(.*)$/);
    if (ms) { serial = ms[1]; continue; }
    const ma = line.match(/^자산기번\s*:\s*(.*)$/);
    if (ma) { asset = ma[1]; continue; }
  }
  flush();
  return labels;
}

function applyAirPurifierForm(text: string, f: AirPurifierForm, author: string): string {
  return text.split("\n").map((line: string) => {
    if (/^작성자\s*:/.test(line)) {
      return author.trim() ? line.replace(/^(작성자\s*:\s*).*/, `$1${author.trim()}`) : line;
    }
    if (/^필터리셋\s*:/.test(line)) {
      return f.filterReset.trim() ? `필터리셋:${f.filterReset.trim()}` : "필터리셋:";
    }
    if (/^필터교체\s*:/.test(line)) {
      return f.filterChange.trim() ? `필터교체:${f.filterChange.trim()}` : "필터교체:";
    }
    if (/^특이사항\s*:/.test(line)) {
      return suffixIfValue("특이사항:", f.notes);
    }
    if (/^도착 시간\s*:/.test(line)) {
      const arrival = f.arrivalHour
        ? `${f.arrivalHour}:${f.arrivalMinute || "00"}`
        : "";
      return suffixIfValue("도착 시간:", arrival);
    }
    if (/^소요 시간\s*:/.test(line)) {
      const duration = f.duration.trim() ? `${f.duration.trim()}분` : "";
      return suffixIfValue("소요 시간:", duration);
    }
    return line;
  }).join("\n");
}

const TONER_OPTIONS = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "100"];
const WASTE_OPTIONS = ["10", "20", "30", "40", "50", "60", "70", "80", "90", "100"];
const SPARE_OPTIONS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const HANTIN_OPTIONS = ["한공", "한조", "한조해지업체", "보안으로 설치불가", "고객불편으로 설치불가", "무"];
const PARKING_OPTIONS = ["유", "무"];
const SHIP_OPTIONS = ["출고부탁드립니다", "선출고완료"];
const HOUR_OPTIONS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
const MINUTE_OPTIONS = ["00", "10", "20", "30", "40", "50"];
const DURATION_STEPS = [1, 5, 10, 30, 60];
const LEVEL_OPTIONS = ["1", "2", "3", "4", "5"];
const YESNO_OPTIONS = ["유", "무"];

const TONER_COLORS: Record<string, string> = {
  K: "#111827",
  C: "#06B6D4",
  M: "#EC4899",
  Y: "#EAB308",
};

type NumSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
  accent: string;
  suffix?: string;
};

function NumSelect({ value, onChange, options, labels, placeholder, accent, suffix }: NumSelectProps) {
  const [open, setOpen] = useState(false);
  const filled = value !== "";
  const label = placeholder ?? "선택";
  const labelFor = (v: string): string => {
    if (labels) {
      const idx = options.indexOf(v);
      if (idx >= 0) return labels[idx];
    }
    return `${v}${suffix ?? ""}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: filled ? "white" : "#F1F5F9",
          borderLeft: filled ? `3px solid ${accent}` : "3px solid transparent",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? labelFor(value) : label}</span>
        <span className="ml-1 text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="flex w-full flex-col rounded-t-2xl bg-white shadow-2xl"
            style={{ maxHeight: "75vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500"
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="block w-full px-5 py-3 text-left text-sm text-slate-500 transition active:bg-slate-100"
              >
                해제
              </button>
              {options.map((opt: string, i: number) => {
                const active = value === opt;
                const text = labels?.[i] ?? `${opt}${suffix ?? ""}`;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className="block w-full px-5 py-3 text-left text-sm transition active:bg-slate-100"
                    style={{
                      background: active ? accent : "transparent",
                      color: active ? "white" : "#0F172A",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type AuthorPickerProps = {
  value: string;
  onChange: (v: string) => void;
  accent: string;
};

function AuthorPicker({ value, onChange, accent }: AuthorPickerProps) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<AuthorTeam>("팀장");
  const filled = value !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm outline-none transition active:scale-[0.99]"
        style={{
          background: filled ? "white" : "#F1F5F9",
          borderLeft: filled ? `3px solid ${accent}` : "3px solid transparent",
          fontWeight: filled ? 600 : 400,
          color: filled ? "#0F172A" : "#64748B",
        }}
      >
        <span className="truncate">{filled ? value : "작성자 선택"}</span>
        <span className="ml-1 text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="flex w-full flex-col rounded-t-2xl bg-white shadow-2xl"
            style={{ maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">작성자 선택</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500"
              >
                닫기
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1 border-b border-slate-100 px-3 py-2">
              {AUTHOR_TEAMS.map((t: AuthorTeam) => {
                const active = team === t;
                const label = t === "팀장" ? "팀장" : `${t}팀`;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTeam(t)}
                    className="rounded-lg py-2 text-xs font-semibold transition active:scale-95"
                    style={{
                      background: active ? accent : "#F1F5F9",
                      color: active ? "white" : "#334155",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto py-1 pb-3">
              {AUTHOR_BOOK[team].map((name: string) => {
                const active = value === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                    className="block w-full border-b border-slate-50 px-5 py-3 text-left text-sm transition active:bg-slate-100"
                    style={{
                      background: active ? accent : "transparent",
                      color: active ? "white" : "#0F172A",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type FormFieldRowProps = {
  label: string;
  dotColor?: string;
  children: ReactNode;
};

function FieldRow({ label, dotColor, children }: FormFieldRowProps) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {dotColor && (
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-slate-300"
          style={{ background: dotColor }}
        />
      )}
      <span className="w-5 shrink-0 text-xs font-semibold text-slate-600">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type ProcessingFormPanelProps = {
  itemForm: PerItemForm;
  setItemF: <K extends keyof PerItemForm>(key: K, value: PerItemForm[K]) => void;
  toggleItemF: (key: keyof PerItemForm, value: string) => void;
  shared: SharedForm;
  setSharedF: <K extends keyof SharedForm>(key: K, value: SharedForm[K]) => void;
  itemCount: number;
  itemLabels: string[];
  selectedItem: number;
  setSelectedItem: (i: number) => void;
  accent: string;
  bgSoft: string;
  author: string;
  setAuthor: (v: string) => void;
  showLevel: boolean;
};

function ProcessingFormPanel({
  itemForm, setItemF, toggleItemF,
  shared, setSharedF,
  itemCount, itemLabels, selectedItem, setSelectedItem,
  accent, bgSoft,
  author, setAuthor, showLevel,
}: ProcessingFormPanelProps) {
  const numInputClass =
    "w-full rounded-lg bg-slate-50 px-2 py-1.5 text-sm outline-none focus:bg-white";
  const textInputClass =
    "w-full rounded-lg bg-slate-50 px-2 py-1.5 text-sm outline-none focus:bg-white";

  return (
    <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">처리내용 입력</label>
        <span className="text-[10px] text-slate-400">입력 즉시 결과에 반영</span>
      </div>

      {/* 작성자 / 레벨 */}
      <div className={`mb-2 grid gap-2 ${showLevel ? "grid-cols-[1fr_auto]" : ""}`}>
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-700">작성자</div>
          <AuthorPicker
            value={author}
            onChange={setAuthor}
            accent={accent}
          />
        </div>
        {showLevel && (
          <div className="w-24">
            <div className="mb-1 text-xs font-semibold text-slate-700">레벨</div>
            <NumSelect
              value={shared.level}
              onChange={(v) => setSharedF("level", v)}
              options={LEVEL_OPTIONS}
              placeholder="-"
              accent={accent}
            />
          </div>
        )}
      </div>

      {/* 기기 선택 (2대 이상일 때만) */}
      {itemCount > 1 && (
        <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">기기 선택</span>
            <span className="text-[10px] text-slate-500">{itemCount}대 중 {selectedItem + 1}번 편집 중</span>
          </div>
          <NumSelect
            value={String(selectedItem)}
            onChange={(v) => {
              const n = parseInt(v, 10);
              if (!isNaN(n)) setSelectedItem(n);
            }}
            options={Array.from({ length: itemCount }, (_, i: number) => String(i))}
            labels={Array.from({ length: itemCount }, (_, i: number) => itemLabels[i] ?? `${i + 1}.`)}
            placeholder="기기 선택"
            accent={accent}
          />
        </div>
      )}

      {/* 처리내용 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">처리내용</div>
        <textarea
          value={itemForm.processContent}
          onChange={(e) => setItemF("processContent", e.target.value)}
          placeholder="예: 정기점검 / 헤드 청소 후 테스트 출력 정상"
          rows={4}
          className="w-full resize-y rounded-lg bg-slate-50 p-2 text-sm outline-none focus:bg-white"
        />
      </div>

      {/* 매수 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">매수</div>
        <div className="grid grid-cols-4 gap-1.5">
          <input
            inputMode="numeric"
            placeholder="흑"
            value={itemForm.mailBlack}
            onChange={(e) => setItemF("mailBlack", e.target.value)}
            className={numInputClass}
          />
          <input
            inputMode="numeric"
            placeholder="컬"
            value={itemForm.mailColor}
            onChange={(e) => setItemF("mailColor", e.target.value)}
            className={numInputClass}
          />
          <input
            inputMode="numeric"
            placeholder="큰컬"
            value={itemForm.mailLargeColor}
            onChange={(e) => setItemF("mailLargeColor", e.target.value)}
            className={numInputClass}
          />
          <input
            inputMode="numeric"
            placeholder="합"
            value={itemForm.mailTotal}
            onChange={(e) => setItemF("mailTotal", e.target.value)}
            className={numInputClass}
          />
        </div>
      </div>

      {/* 토너잔량 */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1 text-xs font-semibold text-slate-700">토너잔량 (%)</div>
        <div className="grid grid-cols-2 gap-x-2">
          <FieldRow label="K" dotColor={TONER_COLORS.K}>
            <NumSelect value={itemForm.tonerK} onChange={(v) => setItemF("tonerK", v)} options={TONER_OPTIONS} accent={accent} suffix="%" />
          </FieldRow>
          <FieldRow label="C" dotColor={TONER_COLORS.C}>
            <NumSelect value={itemForm.tonerC} onChange={(v) => setItemF("tonerC", v)} options={TONER_OPTIONS} accent={accent} suffix="%" />
          </FieldRow>
          <FieldRow label="M" dotColor={TONER_COLORS.M}>
            <NumSelect value={itemForm.tonerM} onChange={(v) => setItemF("tonerM", v)} options={TONER_OPTIONS} accent={accent} suffix="%" />
          </FieldRow>
          <FieldRow label="Y" dotColor={TONER_COLORS.Y}>
            <NumSelect value={itemForm.tonerY} onChange={(v) => setItemF("tonerY", v)} options={TONER_OPTIONS} accent={accent} suffix="%" />
          </FieldRow>
        </div>
      </div>

      {/* 폐통 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">폐통 (%)</div>
        <NumSelect value={itemForm.waste} onChange={(v) => setItemF("waste", v)} options={WASTE_OPTIONS} accent={accent} suffix="%" />
      </div>

      {/* 여분 */}
      <div className="mb-2 rounded-xl p-2" style={{ background: bgSoft }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">여분</span>
          <span className="text-[10px] text-slate-500">전체 한번에 설정</span>
        </div>
        <div className="mb-1.5">
          <FieldRow label="전">
            <NumSelect
              value=""
              onChange={(v) => {
                if (!v) return;
                setItemF("spareK", v);
                setItemF("spareC", v);
                setItemF("spareM", v);
                setItemF("spareY", v);
                setItemF("spareWaste", v);
              }}
              options={SPARE_OPTIONS}
              placeholder="일괄 설정"
              accent={accent}
            />
          </FieldRow>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          <FieldRow label="K" dotColor={TONER_COLORS.K}>
            <NumSelect value={itemForm.spareK} onChange={(v) => setItemF("spareK", v)} options={SPARE_OPTIONS} accent={accent} />
          </FieldRow>
          <FieldRow label="C" dotColor={TONER_COLORS.C}>
            <NumSelect value={itemForm.spareC} onChange={(v) => setItemF("spareC", v)} options={SPARE_OPTIONS} accent={accent} />
          </FieldRow>
          <FieldRow label="M" dotColor={TONER_COLORS.M}>
            <NumSelect value={itemForm.spareM} onChange={(v) => setItemF("spareM", v)} options={SPARE_OPTIONS} accent={accent} />
          </FieldRow>
          <FieldRow label="Y" dotColor={TONER_COLORS.Y}>
            <NumSelect value={itemForm.spareY} onChange={(v) => setItemF("spareY", v)} options={SPARE_OPTIONS} accent={accent} />
          </FieldRow>
        </div>
        <FieldRow label="폐">
          <NumSelect value={itemForm.spareWaste} onChange={(v) => setItemF("spareWaste", v)} options={SPARE_OPTIONS} accent={accent} />
        </FieldRow>
      </div>

      {/* 한틴이카 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">한틴이카유무</div>
        <div className="flex flex-wrap gap-1">
          {HANTIN_OPTIONS.map((opt: string) => {
            const active = itemForm.hantin === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggleItemF("hantin", opt)}
                className="rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-95"
                style={{
                  background: active ? accent : "#F1F5F9",
                  color: active ? "white" : "#334155",
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* 주차비 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">주차비지원유무</div>
        <div className="flex flex-wrap items-center gap-1">
          {PARKING_OPTIONS.map((opt: string) => {
            const active = itemForm.parkingChip === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  toggleItemF("parkingChip", opt);
                  if (itemForm.parkingChip !== opt) setItemF("parkingCustom", "");
                }}
                className="rounded-full px-3 py-1 text-xs font-medium transition active:scale-95"
                style={{
                  background: active ? accent : "#F1F5F9",
                  color: active ? "white" : "#334155",
                }}
              >
                {opt}
              </button>
            );
          })}
          <input
            type="text"
            placeholder="직접 입력 (우선 적용)"
            value={itemForm.parkingCustom}
            onChange={(e) => {
              setItemF("parkingCustom", e.target.value);
              if (e.target.value) setItemF("parkingChip", "");
            }}
            className="ml-1 min-w-0 flex-1 rounded-lg bg-slate-50 px-2 py-1.5 text-xs outline-none focus:bg-white"
          />
        </div>
      </div>

      {/* 특이사항 */}
      <div className="mb-3">
        <div className="mb-1 text-xs font-semibold text-slate-700">특이사항</div>
        <textarea
          value={itemForm.notes}
          onChange={(e) => setItemF("notes", e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg bg-slate-50 p-2 text-sm outline-none focus:bg-white"
        />
      </div>

      {/* 부품신청 */}
      <div className="mb-3 rounded-xl border border-slate-200 p-2">
        <div className="mb-2 text-xs font-bold text-slate-700">※ 부품신청 ※</div>
        <div className="space-y-1.5">
          <div>
            <div className="text-[11px] text-slate-500">보증기간 내 여부</div>
            <input value={shared.warranty} onChange={(e) => setSharedF("warranty", e.target.value)} className={textInputClass} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">교체 전 카운터 누적 사용매수</div>
            <input value={shared.cumCount} onChange={(e) => setSharedF("cumCount", e.target.value)} inputMode="numeric" className={textInputClass} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">사용 부품 예상 사용매수</div>
            <input value={shared.expectedCount} onChange={(e) => setSharedF("expectedCount", e.target.value)} inputMode="numeric" className={textInputClass} />
          </div>
          <div className="pt-1 text-[11px] font-semibold text-slate-600">▶ 신청 부품</div>
          <div>
            <div className="text-[11px] text-slate-500">물품명</div>
            <input value={shared.partName} onChange={(e) => setSharedF("partName", e.target.value)} className={textInputClass} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[11px] text-slate-500">수량</div>
              <input value={shared.partQty} onChange={(e) => setSharedF("partQty", e.target.value)} inputMode="numeric" className={textInputClass} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500">출고여부</div>
              <NumSelect
                value={shared.partShipped}
                onChange={(v) => setSharedF("partShipped", v)}
                options={SHIP_OPTIONS}
                accent={accent}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 자가신청 */}
      <div className="mb-3 rounded-xl border border-slate-200 p-2">
        <div className="mb-2 text-xs font-bold text-slate-700">※ 자가신청 ※</div>
        <div className="space-y-1.5">
          <div>
            <div className="text-[11px] text-slate-500">물품</div>
            <input value={shared.selfItem} onChange={(e) => setSharedF("selfItem", e.target.value)} className={textInputClass} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[11px] text-slate-500">수량</div>
              <input value={shared.selfQty} onChange={(e) => setSharedF("selfQty", e.target.value)} inputMode="numeric" className={textInputClass} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500">출고여부</div>
              <NumSelect
                value={shared.selfShipped}
                onChange={(v) => setSharedF("selfShipped", v)}
                options={SHIP_OPTIONS}
                accent={accent}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 시간 */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">도착 시간</span>
            {shared.arrivalHour && (
              <span className="text-xs font-semibold" style={{ color: accent }}>
                {shared.arrivalHour}:{shared.arrivalMinute || "00"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumSelect
              value={shared.arrivalHour}
              onChange={(v) => setSharedF("arrivalHour", v)}
              options={HOUR_OPTIONS}
              placeholder="시"
              accent={accent}
              suffix="시"
            />
            <NumSelect
              value={shared.arrivalMinute}
              onChange={(v) => setSharedF("arrivalMinute", v)}
              options={MINUTE_OPTIONS}
              placeholder="분"
              accent={accent}
              suffix="분"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">소요 시간</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: accent }}>
                {shared.duration ? `${shared.duration}분` : "0분"}
              </span>
              {shared.duration && (
                <button
                  type="button"
                  onClick={() => setSharedF("duration", "")}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 active:scale-95"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {DURATION_STEPS.map((step: number) => (
              <button
                key={step}
                type="button"
                onClick={() => {
                  const current = parseInt(shared.duration || "0", 10) || 0;
                  setSharedF("duration", String(current + step));
                }}
                className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
              >
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

type AirPurifierFormPanelProps = {
  form: AirPurifierForm;
  setAirF: <K extends keyof AirPurifierForm>(key: K, value: AirPurifierForm[K]) => void;
  accent: string;
  author: string;
  setAuthor: (v: string) => void;
};

function AirPurifierFormPanel({
  form, setAirF, accent,
  author, setAuthor,
}: AirPurifierFormPanelProps) {
  return (
    <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">청정기 입력</label>
        <span className="text-[10px] text-slate-400">입력 즉시 결과에 반영</span>
      </div>

      {/* 작성자 */}
      <div className="mb-2">
        <div className="mb-1 text-xs font-semibold text-slate-700">작성자</div>
        <AuthorPicker
          value={author}
          onChange={setAuthor}
          accent={accent}
        />
      </div>

      {/* 필터리셋 / 필터교체 */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-700">필터리셋</div>
          <NumSelect
            value={form.filterReset}
            onChange={(v) => setAirF("filterReset", v)}
            options={YESNO_OPTIONS}
            placeholder="-"
            accent={accent}
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-700">필터교체</div>
          <NumSelect
            value={form.filterChange}
            onChange={(v) => setAirF("filterChange", v)}
            options={YESNO_OPTIONS}
            placeholder="-"
            accent={accent}
          />
        </div>
      </div>

      {/* 특이사항 */}
      <div className="mb-3">
        <div className="mb-1 text-xs font-semibold text-slate-700">특이사항</div>
        <textarea
          value={form.notes}
          onChange={(e) => setAirF("notes", e.target.value)}
          rows={3}
          className="w-full resize-y rounded-lg bg-slate-50 p-2 text-sm outline-none focus:bg-white"
        />
      </div>

      {/* 시간 */}
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">도착 시간</span>
            {form.arrivalHour && (
              <span className="text-xs font-semibold" style={{ color: accent }}>
                {form.arrivalHour}:{form.arrivalMinute || "00"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumSelect
              value={form.arrivalHour}
              onChange={(v) => setAirF("arrivalHour", v)}
              options={HOUR_OPTIONS}
              placeholder="시"
              accent={accent}
              suffix="시"
            />
            <NumSelect
              value={form.arrivalMinute}
              onChange={(v) => setAirF("arrivalMinute", v)}
              options={MINUTE_OPTIONS}
              placeholder="분"
              accent={accent}
              suffix="분"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">소요 시간</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: accent }}>
                {form.duration ? `${form.duration}분` : "0분"}
              </span>
              {form.duration && (
                <button
                  type="button"
                  onClick={() => setAirF("duration", "")}
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 active:scale-95"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {DURATION_STEPS.map((step: number) => (
              <button
                key={step}
                type="button"
                onClick={() => {
                  const current = parseInt(form.duration || "0", 10) || 0;
                  setAirF("duration", String(current + step));
                }}
                className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
              >
                +{step}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState<Mode>("inspection");
  const [inputText, setInputText] = useState<string>("");
  const [textOutput, setTextOutput] = useState<string>("");
  const [listOutput, setListOutput] = useState<ResultItem[]>([]);
  const [toast, setToast] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [itemForms, setItemForms] = useState<PerItemForm[]>([EMPTY_ITEM_FORM]);
  const [sharedForm, setSharedForm] = useState<SharedForm>(EMPTY_SHARED_FORM);
  const [selectedItem, setSelectedItem] = useState<number>(0);
  const [airForm, setAirForm] = useState<AirPurifierForm>(EMPTY_AIR_FORM);
  const [editedContents, setEditedContents] = useState<Record<number, string>>({});
  const [editedTextOutput, setEditedTextOutput] = useState<string | null>(null);

  const [author, setAuthor] = useState<string>(() => {
    try { return localStorage.getItem("author") || ""; } catch { return ""; }
  });

  useEffect(() => {
    try { localStorage.setItem("author", author); } catch {
      // ignore quota / private mode errors
    }
  }, [author]);

  const config = MODE_CONFIG[mode];
  const isListMode = mode === "samsung-note" || mode === "blank-report";
  const showForm = mode === "blank-report" || mode === "inspection";
  const showAirForm = mode === "air-purifier";

  const displayedList = useMemo(() => {
    if (mode !== "blank-report") return listOutput;
    return listOutput.map((item: ResultItem, i: number) => ({
      ...item,
      content: applyProcessingFormV2(
        item.content,
        [itemForms[i] ?? EMPTY_ITEM_FORM],
        sharedForm,
        author,
      ),
    }));
  }, [mode, listOutput, itemForms, sharedForm, author]);

  const displayedTextOutput = useMemo(() => {
    if (mode === "air-purifier") {
      return applyAirPurifierForm(textOutput, airForm, author);
    }
    if (mode === "inspection") {
      return applyProcessingFormV2(textOutput, itemForms, sharedForm, author);
    }
    return textOutput;
  }, [mode, textOutput, airForm, itemForms, sharedForm, author]);

  const effectiveTextOutput = editedTextOutput ?? displayedTextOutput;

  const currentItemForm = itemForms[selectedItem] ?? EMPTY_ITEM_FORM;

  const itemLabels = useMemo(() => {
    if (mode === "inspection") return extractInspectionItemLabels(textOutput);
    if (mode === "blank-report") {
      return listOutput.map((item: ResultItem, i: number) => {
        const labels = extractInspectionItemLabels(item.content);
        return labels[0] ?? `${i + 1}.`;
      });
    }
    return [];
  }, [mode, textOutput, listOutput]);

  const setItemF = <K extends keyof PerItemForm>(key: K, value: PerItemForm[K]) => {
    setItemForms((prev: PerItemForm[]) => prev.map((f: PerItemForm, i: number) =>
      i === selectedItem ? { ...f, [key]: value } : f,
    ));
  };
  const toggleItemF = (key: keyof PerItemForm, value: string) => {
    setItemForms((prev: PerItemForm[]) => prev.map((f: PerItemForm, i: number) =>
      i === selectedItem ? { ...f, [key]: f[key] === value ? "" : value } : f,
    ));
  };
  const setSharedF = <K extends keyof SharedForm>(key: K, value: SharedForm[K]) => {
    setSharedForm((prev: SharedForm) => ({ ...prev, [key]: value }));
  };
  const setAirF = <K extends keyof AirPurifierForm>(key: K, value: AirPurifierForm[K]) => {
    setAirForm((prev: AirPurifierForm) => ({ ...prev, [key]: value }));
  };

  const lineStats = useMemo(() => {
    const count = inputText ? inputText.split(/\r?\n/).length : 0;
    return `${count}줄`;
  }, [inputText]);

  const showToast = (text: string, kind: "success" | "error" = "success") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 1600);
  };

  const resetOutputs = () => {
    setTextOutput("");
    setListOutput([]);
    setCopiedIndex(null);
    setEditedContents({});
    setEditedTextOutput(null);
  };

  const handleModeChange = (next: Mode) => {
    setMode(next);
  };

  const runTransform = (text: string, m: Mode) => {
    let nextItemCount = 1;
    if (m === "inspection") {
      const out = transformInspectionText(text);
      setTextOutput(out);
      setListOutput([]);
      nextItemCount = Math.max(1, countInspectionItems(out));
    } else if (m === "air-purifier") {
      setTextOutput(transformAirPurifierText(text));
      setListOutput([]);
    } else if (m === "samsung-note") {
      setListOutput(transformSamsungNoteTitles(text));
      setTextOutput("");
    } else {
      const items = transformBlankReports(text);
      setListOutput(items);
      setTextOutput("");
      nextItemCount = Math.max(1, items.length);
    }
    setItemForms((prev: PerItemForm[]) => {
      if (prev.length === nextItemCount) return prev;
      return Array.from({ length: nextItemCount }, (_, i: number) => prev[i] ?? { ...EMPTY_ITEM_FORM });
    });
    setSelectedItem((prev: number) => Math.min(prev, Math.max(0, nextItemCount - 1)));
    setCopiedIndex(null);
    setEditedContents({});
    setEditedTextOutput(null);
  };

  const handleTransform = () => {
    if (!inputText.trim()) {
      showToast("입력이 비어있어요", "error");
      return;
    }
    runTransform(inputText, mode);
  };

  // Auto-transform on input or mode change (debounced)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!inputText.trim()) {
        resetOutputs();
        setItemForms([{ ...EMPTY_ITEM_FORM }]);
        setSharedForm(EMPTY_SHARED_FORM);
        setSelectedItem(0);
        return;
      }
      runTransform(inputText, mode);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [inputText, mode]);

  const handlePaste = async () => {
    const text = await pasteFromClipboard();
    if (text === null) {
      showToast("클립보드 권한이 필요해요", "error");
      return;
    }
    setInputText(text);
    showToast("붙여넣기 완료");
  };

  const handleCopyCard = async (text: string, index: number) => {
    const result = await copyTextToClipboard(text);
    if (result.ok) {
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 900);
      showToast("복사 완료");
    } else {
      showToast(result.message, "error");
    }
  };

  const handleCopyAll = async () => {
    const target = isListMode
      ? displayedList.map((item: ResultItem, i: number) => editedContents[i] ?? item.content).join("\n\n")
      : effectiveTextOutput;

    if (!target) {
      showToast("복사할 내용이 없어요", "error");
      return;
    }

    const result = await copyTextToClipboard(target);
    showToast(result.message, result.ok ? "success" : "error");
  };

  const handleReset = () => {
    setInputText("");
    resetOutputs();
    setItemForms([{ ...EMPTY_ITEM_FORM }]);
    setSharedForm(EMPTY_SHARED_FORM);
    setSelectedItem(0);
    setAirForm(EMPTY_AIR_FORM);
    showToast("초기화 완료");
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleTransform();
    }
  };

  const hasOutput = textOutput.length > 0 || listOutput.length > 0;
  const warningCount = displayedList.filter((item: ResultItem) => item.warning).length;

  const isDev = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;
  const testResults = useMemo(() => (isDev ? runSelfTests() : []), [isDev]);
  const passedCount = testResults.filter((item: TestResult) => item.passed).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex max-w-3xl flex-col px-3 pb-32 pt-4 sm:px-6 sm:pt-6">
        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">점검이력 변환기</h1>
            <p className="text-xs text-slate-500 sm:text-sm">
              <span style={{ color: config.accent }}>●</span> {config.label} 모드
            </p>
          </div>
          <div className="text-xs text-slate-400">{lineStats}</div>
        </header>

        {/* Mode tabs - segmented control */}
        <div
          className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-200/60 p-1"
          role="tablist"
        >
          {MODE_ORDER.map((m: Mode) => {
            const c = MODE_CONFIG[m];
            const active = m === mode;
            return (
              <button
                key={m}
                role="tab"
                aria-selected={active}
                onClick={() => handleModeChange(m)}
                className={`rounded-xl py-2.5 text-sm transition ${
                  active ? "font-semibold" : "font-normal text-slate-500"
                }`}
                style={{
                  background: active ? "white" : "transparent",
                  color: active ? c.textDark : undefined,
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.04)" : undefined,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Input */}
        <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600">원본 입력</label>
            <button
              onClick={handlePaste}
              className="rounded-lg px-2 py-1 text-xs font-medium transition active:scale-95"
              style={{ color: config.accent, background: config.bgSoft }}
            >
              📋 붙여넣기
            </button>
          </div>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={config.placeholder}
            className="h-44 w-full resize-none rounded-xl bg-slate-50 p-3 font-mono text-sm outline-none transition focus:bg-white sm:h-56"
            style={{ borderColor: config.accent }}
          />
        </section>

        {/* Processing form — 미양식 + 점검 */}
        {showForm && (
          <ProcessingFormPanel
            itemForm={currentItemForm}
            setItemF={setItemF}
            toggleItemF={toggleItemF}
            shared={sharedForm}
            setSharedF={setSharedF}
            itemCount={itemForms.length}
            itemLabels={itemLabels}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            accent={config.accent}
            bgSoft={config.bgSoft}
            author={author}
            setAuthor={setAuthor}
            showLevel={mode === "blank-report"}
          />
        )}

        {/* Air purifier form — only for 청정기 */}
        {showAirForm && (
          <AirPurifierFormPanel
            form={airForm}
            setAirF={setAirF}
            accent={config.accent}
            author={author}
            setAuthor={setAuthor}
          />
        )}

        {/* Results */}
        {hasOutput && (
          <section className="mb-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-xs font-medium text-slate-600">
                결과{" "}
                {isListMode && (
                  <>
                    <span className="text-slate-400">· {displayedList.length}건</span>
                    {warningCount > 0 && (
                      <span className="ml-1 text-amber-600">⚠️ {warningCount}건 확인 필요</span>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={handleCopyAll}
                className="text-xs font-medium"
                style={{ color: config.accent }}
              >
                전체 복사
              </button>
            </div>

            {isListMode ? (
              <div className="space-y-2">
                {displayedList.map((item: ResultItem, index: number) => {
                  const hasWarning = Boolean(item.warning);
                  const isCopied = copiedIndex === index;
                  const text = editedContents[index] ?? item.content;
                  const cardBg = isCopied
                    ? "#D1FAE5"
                    : hasWarning
                      ? "#FEF3C7"
                      : config.bgSoft;
                  const borderColor = isCopied
                    ? "#10B981"
                    : hasWarning
                      ? "#D97706"
                      : config.accent;
                  const lineCount = text.split("\n").length;

                  return (
                    <div
                      key={index}
                      className="rounded-xl p-3"
                      style={{
                        background: cardBg,
                        borderLeft: `3px solid ${borderColor}`,
                      }}
                    >
                      <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                        <span style={{ color: hasWarning ? "#92400E" : config.textDark }}>
                          {hasWarning ? "⚠️" : ""} {index + 1}
                          {hasWarning ? ` · ${item.warning}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyCard(text, index)}
                          className="rounded-md px-2 py-1 text-xs font-semibold transition active:scale-95"
                          style={{
                            background: isCopied ? "#10B981" : "white",
                            color: isCopied ? "white" : config.accent,
                            border: `1px solid ${isCopied ? "#10B981" : config.accent}`,
                          }}
                        >
                          {isCopied ? "✓ 복사됨" : "📋 복사"}
                        </button>
                      </div>
                      <textarea
                        value={text}
                        onChange={(e) =>
                          setEditedContents((prev: Record<number, string>) => ({
                            ...prev,
                            [index]: e.target.value,
                          }))
                        }
                        rows={Math.max(8, lineCount)}
                        className="w-full resize-y rounded-lg bg-white/60 p-2 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:bg-white"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="rounded-xl p-3"
                style={{
                  background: config.bgSoft,
                  borderLeft: `3px solid ${config.accent}`,
                }}
              >
                <textarea
                  value={effectiveTextOutput}
                  onChange={(e) => setEditedTextOutput(e.target.value)}
                  className="h-72 w-full resize-none bg-transparent font-mono text-xs leading-relaxed outline-none sm:h-96"
                />
              </div>
            )}
          </section>
        )}

        {/* Dev-only test panel */}
        {isDev && testResults.length > 0 && (
          <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700">
                내장 테스트 (DEV)
              </h3>
              <span className="text-xs text-slate-400">
                {passedCount}/{testResults.length} 통과
              </span>
            </div>
            <div className="space-y-1.5">
              {testResults.map((test: TestResult) => (
                <div
                  key={test.name}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-xs"
                >
                  <span className="truncate text-slate-700">{test.name}</span>
                  <span
                    className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      test.passed
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {test.passed ? "OK" : "FAIL"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky bottom action bar — thumb zone */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-3 sm:px-6">
          <button
            onClick={handleReset}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-600 transition active:scale-95"
            aria-label="초기화"
          >
            초기화
          </button>
          <button
            onClick={handleTransform}
            className="shrink-0 rounded-xl px-5 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
            style={{ background: config.accent }}
          >
            ⚡ 변환
          </button>
          <button
            onClick={handleCopyAll}
            disabled={!hasOutput}
            className="flex-1 rounded-xl border-2 bg-white py-3 text-sm font-semibold transition active:scale-[0.98] disabled:border-slate-200 disabled:text-slate-300"
            style={hasOutput ? { borderColor: config.accent, color: config.accent } : undefined}
            aria-label="결과 전체 복사"
          >
            📋 복사
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg"
          style={{
            background: toast.kind === "success" ? "#065F46" : "#991B1B",
            color: "white",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
