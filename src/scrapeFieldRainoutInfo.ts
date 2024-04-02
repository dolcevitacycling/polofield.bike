import xlsx from "node-xlsx";
import fetchCookie from "fetch-cookie";

const FIELD_RAINOUT_INFO_URL =
  "https://fs18.formsite.com/res/resultsReportTable?EParam=B6fiTn%2BRcO5gxPxCLTtif%2FTBZfQjAcbzwCi9jw02kUQSq0hsyAedVkhBtIa3wGQcGW07E1SN8yI%3D";
const FIELD_RAINOUT_EXPORT_URL =
  "https://fs18.formsite.com/res/resultsReportExport?EParam=B6fiTn-RcO5gxPxCLTtif_TBZfQjAcbzwCi9jw02kUQSq0hsyAedVkhBtIa3wGQcGW07E1SN8yI";

enum FieldComplex {
  ALL_GRASS_FIELDS_AND_DIAMONDS = "all grass fields & diamonds",
  OTHER_FIELDS = "other fields",
  ALL_FIELDS_EXCEPT = "all fields except (see next)",
  POLO_FIELDS = "polo fields",
  OTHER_SEE_BELOW = "other see below",
}

enum ClosedFieldStatus {
  CLOSED = "closed",
  ALL_CLOSED = "closed all fields closed",
}

enum OpenFieldStatus {
  OPEN = "open",
  OPEN_FIELDS = "open fields",
}

const CLOSED_STATUSES: string[] = Object.values(ClosedFieldStatus);
const OPEN_STATUSES: string[] = Object.values(OpenFieldStatus);

export interface PoloFieldStatus {
  readonly explicit: boolean;
  readonly trackOpen: boolean;
  readonly row: readonly string[];
}

/* Semigroup */
function choosePoloFieldStatus(
  newer: PoloFieldStatus,
  older: PoloFieldStatus,
): PoloFieldStatus {
  return older.explicit && !newer.explicit ? older : newer;
}

export function isTrackOpen(status: PoloFieldStatus) {
  return status.trackOpen;
}

export async function downloadFieldRainoutInfoXLSX(): Promise<ArrayBuffer> {
  /**
   * Fetch the field rainout info as an XLSX.
   *
   * This request fails if we don't set cookies in the header, so we do a base request first,
   * then sub the cookies from that response into the next request.
   */
  const fetchWithCookies = fetchCookie(fetch);
  // This has the side-effect of setting the cookie to authorize the export request
  await fetchWithCookies(FIELD_RAINOUT_INFO_URL).then((res) => res.text());
  const response = await fetchWithCookies(FIELD_RAINOUT_EXPORT_URL);
  const blob = await response.blob();
  return await blob.arrayBuffer();
}

function withPatchedConsoleError<T>(fn: () => T): T {
  const originalConsoleError = console.error;
  try {
    console.error = (...args: any[]) => {
      if (
        typeof args[0] === "string" &&
        /^Bad (un)?compressed size/.test(args[0])
      ) {
        return;
      }
      originalConsoleError.apply(console, args);
    };
    return fn();
  } finally {
    console.error = originalConsoleError;
  }
}

export const downloadFieldRainoutInfo = async (rawSheet?: ArrayBuffer) => {
  /**
   * Fetch the field rainout info as a parsed XLSX.
   *
   */
  const arrayBuffer = rawSheet ?? (await downloadFieldRainoutInfoXLSX());
  return withPatchedConsoleError(() => xlsx.parse(arrayBuffer, { raw: false }));
};

export function parseFieldRainoutRowDate(row: string[]) {
  const splitDate = row[0].split("/");
  const date = `${splitDate[2]}-${splitDate[0]}-${splitDate[1]}`;
  return date;
}

export function parseFieldRainoutRow(row: string[]): PoloFieldStatus {
  /**
   * Returns true if the cycle track is open (polo field closed due to rain)
   */
  const fieldComplex = row[2].toLowerCase();
  const fieldStatus = row[3].toLowerCase();
  const additionalInformation = row[4];
  const additionalInformationArr =
    additionalInformation && additionalInformation.trim() !== ""
      ? additionalInformation
          .split("\n")
          .map((entry) => entry.trim().toLowerCase())
      : [];

  if (
    fieldComplex === FieldComplex.ALL_GRASS_FIELDS_AND_DIAMONDS &&
    CLOSED_STATUSES.includes(fieldStatus)
  ) {
    // the easy case: all of the fields are closed
    return { explicit: true, trackOpen: true, row };
  } else if (
    fieldComplex === FieldComplex.OTHER_FIELDS ||
    fieldComplex === FieldComplex.OTHER_SEE_BELOW
  ) {
    // second most common case: some subset of fields is explicitly listed as open or closed
    if (additionalInformationArr.includes("polo")) {
      const maybeFieldStatus = additionalInformationArr[0].replace(/\W/g, "");
      return {
        explicit: true,
        trackOpen:
          CLOSED_STATUSES.includes(fieldStatus) ||
          CLOSED_STATUSES.includes(maybeFieldStatus),
        row,
      };
    }
  } else if (fieldComplex === FieldComplex.POLO_FIELDS) {
    // the polo fields are specifically listed as open/closed - pretty uncommon
    return {
      explicit: true,
      trackOpen: CLOSED_STATUSES.includes(fieldStatus),
      row,
    };
  } else if (fieldComplex === FieldComplex.ALL_FIELDS_EXCEPT) {
    // this status reverses whatever the field status is for the listed field
    if (additionalInformationArr.includes("polo")) {
      return {
        explicit: true,
        trackOpen: OPEN_STATUSES.includes(fieldStatus),
        row,
      };
    }
    return {
      explicit: false,
      trackOpen: CLOSED_STATUSES.includes(fieldStatus),
      row,
    };
  }
  // assume the field is not rained out
  return { explicit: false, trackOpen: false, row };
}

export interface FieldRainoutInfo {
  [date: string]: PoloFieldStatus;
}

export const parseFieldRainoutInfo = (
  rainoutInfo: string[][],
  oldestYear?: number,
): FieldRainoutInfo => {
  /**
   * Parse the rainout info with the oldest entries first.
   *
   * The headers are:
   * 'Date:' - the date
   * 'Day' - the day of the week (Mon, Tues, etc.)
   * 'Field/Complex' - All Grass Fields & Diamonds | Other See Below | All Fields Except (see next) | <specific field name>
   * 'Field Is:'
   * 'Additional Information:'
   *
   * This is because R&P sometimes update the rainout schedule multiple times in a day,
   * with newer entries appearing earlier in the list. Reducing from the right
   * allows the newer entries to override the older ones.
   *
   * This schedule goes back to 2015, so we filter by date because we really only care about
   * the most recent entries.
   *
   * This should cover most of the common cases. It's not really possible to do much with the "check back later" ones.
   *
   * If the value for the date is true, the field is rained out (and the cycle track should be open).
   */
  const acc: FieldRainoutInfo = {};
  const prefix = `${oldestYear || 2015}-`;
  for (let i = 1; i < rainoutInfo.length; i++) {
    const row = rainoutInfo[i];
    const date = parseFieldRainoutRowDate(row);
    if (date < prefix) {
      break;
    }
    const newer = acc[date];
    const older = parseFieldRainoutRow(row);
    acc[date] = newer ? choosePoloFieldStatus(newer, older) : older;
  }
  return acc;
};

export const fetchFieldRainoutInfo = async (
  oldestYear: number,
  worksheets?: { name: string; data: any[][] }[],
): Promise<FieldRainoutInfo> => {
  worksheets ||= await downloadFieldRainoutInfo();

  if (!worksheets.length) {
    throw Error("Unable to parse field rainout info as sheet");
  }

  const schedule = worksheets[0];
  const contents = schedule.data;
  return parseFieldRainoutInfo(contents, oldestYear);
};
