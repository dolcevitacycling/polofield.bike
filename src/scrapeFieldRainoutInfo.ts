import xlsx from "node-xlsx";

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

const CLOSED_STATUSES = Object.values(ClosedFieldStatus);
const OPEN_STATUSES = Object.values(OpenFieldStatus);

export const downloadFieldRainoutInfo = async () => {
  /**
   * Fetch the field rainout info as an XLSX.
   *
   * This request fails if we don't set cookies in the header, so we do a base request first,
   * then sub the cookies from that response into the next request.
   */
  const baseResponse = await fetch(FIELD_RAINOUT_INFO_URL);
  const respHeaders = baseResponse.headers;
  const cookies = [...respHeaders.entries()].reduce((acc, [key, value]) => {
    if (key === "set-cookie") {
      acc.push(value);
    }

    return acc;
  }, [] as string[]);

  const headers = new Headers();
  headers.append("Cookie", cookies.join("; "));

  const response = await fetch(FIELD_RAINOUT_EXPORT_URL, { headers });
  const blob = await response.blob();

  return xlsx.parse(await blob.arrayBuffer(), {
    raw: false,
  });
};

export const parseFieldRainoutInfo = (
  rainoutInfo: string[][],
  limit: number = 200,
): { [key: string]: boolean } => {
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
   * with newer entries appearing earlier in the list if it is not reversed. Reversing it
   * allows the newer entries to override the older ones.
   *
   * This schedule goes back to 2015, so we slice it because we really only care about
   * the most recent entries.
   *
   * This should cover most of the common cases. It's not really possible to do much with the "check back later" ones.
   *
   * If the value for the date is true, the field is rained out.
   */
  return rainoutInfo
    .slice(0, limit)
    .reverse()
    .reduce(
      (acc, row) => {
        const splitDate = row[0].split("/");
        const date = `${splitDate[2]}-${splitDate[0]}-${splitDate[1]}`;

        const fieldComplex = row[2].toLowerCase();
        const fieldStatus = row[3].toLowerCase();
        const additionalInformation = row[4];
        const additionalInformationArr =
          additionalInformation && additionalInformation.trim() !== ""
            ? additionalInformation
                .split("\n")
                .map((entry) => entry.trim().toLowerCase())
            : [];

        acc[date] = false; // assume the field is not rained out

        if (
          fieldComplex === FieldComplex.ALL_GRASS_FIELDS_AND_DIAMONDS &&
          CLOSED_STATUSES.includes(fieldStatus as ClosedFieldStatus)
        ) {
          // the easy case: all of the fields are closed
          acc[date] = true;
        } else if (
          fieldComplex === FieldComplex.OTHER_FIELDS ||
          fieldComplex === FieldComplex.OTHER_SEE_BELOW
        ) {
          // second most common case: some subset of fields is explicitly listed as open or closed
          if (additionalInformationArr.includes("polo")) {
            const maybeFieldStatus = additionalInformationArr[0].replace(
              /\W/g,
              "",
            );
            if (
              CLOSED_STATUSES.includes(fieldStatus as ClosedFieldStatus) ||
              CLOSED_STATUSES.includes(maybeFieldStatus as ClosedFieldStatus)
            ) {
              acc[date] = true;
            } else if (
              OPEN_STATUSES.includes(fieldStatus as OpenFieldStatus) ||
              OPEN_STATUSES.includes(maybeFieldStatus as OpenFieldStatus)
            ) {
              acc[date] = false;
            }
          }
        } else if (fieldComplex === FieldComplex.POLO_FIELDS) {
          // the polo fields are specifically listed as open/closed - pretty uncommon
          if (CLOSED_STATUSES.includes(fieldStatus as ClosedFieldStatus)) {
            acc[date] = true;
          } else if (OPEN_STATUSES.includes(fieldStatus as OpenFieldStatus)) {
            acc[date] = false;
          }
        } else if (fieldComplex === FieldComplex.ALL_FIELDS_EXCEPT) {
          // this status reverses whatever the field status is for the listed field
          if (additionalInformationArr.includes("polo")) {
            if (CLOSED_STATUSES.includes(fieldStatus as ClosedFieldStatus)) {
              acc[date] = false;
            } else if (OPEN_STATUSES.includes(fieldStatus as OpenFieldStatus)) {
              acc[date] = true;
            }
          }
        }

        return acc;
      },
      {} as { [key: string]: boolean },
    );
};

export const fetchFieldRainoutInfo = async (
  limit: number = 20,
): Promise<{ [key: string]: boolean }> => {
  const worksheets = await downloadFieldRainoutInfo();

  if (!worksheets.length) {
    throw Error("Unable to parse field rainout info as sheet");
  }

  const schedule = worksheets[0];
  const contents = schedule.data;
  contents.shift(); // pop headers
  return parseFieldRainoutInfo(contents, limit);
};
