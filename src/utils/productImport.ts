import type { ProductImportRow, ProductInsert } from '../types';

const EXPECTED_HEADERS = ['Product Name*', 'SKU*', 'Size', 'Variation', 'Price*', 'Stock*'];

const normalizeHeader = (value: unknown) => String(value ?? '').replace(/\*/g, '').trim().toLowerCase();
const text = (value: unknown) => String(value ?? '').trim();

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function createErrorRow(sourceFile: string, sheetName: string, rowNumber: number, error: string): ProductImportRow {
  return {
    source_file: sourceFile,
    sheet_name: sheetName,
    row_number: rowNumber,
    name: '',
    sku: '',
    size: '',
    variation: '',
    price: null,
    stock: null,
    errors: [error],
  };
}

function headersMatch(headers: unknown[]) {
  return EXPECTED_HEADERS.every((header, index) => normalizeHeader(headers[index]) === normalizeHeader(header));
}

export async function parseProductExcelFiles(files: File[]): Promise<ProductImportRow[]> {
  const XLSX = await import('xlsx');
  const parsedRows: ProductImportRow[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

      if (rows.length === 0) {
        parsedRows.push(createErrorRow(file.name, sheetName, 1, 'Sheet is empty.'));
        continue;
      }

      const headers = rows[0] || [];
      if (!headersMatch(headers)) {
        parsedRows.push(createErrorRow(file.name, sheetName, 1, `Header must be: ${EXPECTED_HEADERS.join(', ')}.`));
        continue;
      }

      const dataRows = rows.slice(1).filter((row) => row.some((cell) => text(cell) !== ''));
      if (dataRows.length === 0) {
        parsedRows.push(createErrorRow(file.name, sheetName, 2, 'Sheet has no product rows.'));
        continue;
      }

      dataRows.forEach((row, index) => {
        const price = numberValue(row[4]);
        const stock = numberValue(row[5]);
        parsedRows.push({
          source_file: file.name,
          sheet_name: sheetName,
          row_number: index + 2,
          name: text(row[0]),
          sku: text(row[1]).toUpperCase(),
          size: text(row[2]),
          variation: text(row[3]),
          price,
          stock,
          errors: [],
        });
      });
    }
  }

  return parsedRows;
}

export function validateProductImportRows(rows: ProductImportRow[], existingSkus: string[]): ProductImportRow[] {
  const uploadedSkuCounts = rows.reduce<Record<string, number>>((counts, row) => {
    if (row.sku) counts[row.sku] = (counts[row.sku] || 0) + 1;
    return counts;
  }, {});
  const existingSkuSet = new Set(existingSkus.map((sku) => sku.toUpperCase()));

  return rows.map((row) => {
    const errors = [...row.errors];
    const isSheetLevelError = errors.length > 0 && !row.name && !row.sku && row.price === null && row.stock === null;

    if (isSheetLevelError) return { ...row, errors };

    if (!row.name) errors.push('Product Name is mandatory.');
    if (!row.sku) errors.push('SKU is mandatory.');
    if (row.price === null) errors.push('Price is mandatory and must be numeric.');
    if (row.price !== null && row.price < 0) errors.push('Price must be 0 or more.');
    if (row.stock === null) errors.push('Stock is mandatory and must be numeric.');
    if (row.stock !== null && (!Number.isInteger(row.stock) || row.stock < 0)) errors.push('Stock must be a whole number 0 or more.');
    if (row.sku && uploadedSkuCounts[row.sku] > 1) errors.push('Duplicate SKU in uploaded files.');
    if (row.sku && existingSkuSet.has(row.sku)) errors.push('SKU already exists in products.');

    return { ...row, errors };
  });
}

export function productImportRowsToInserts(rows: ProductImportRow[]): ProductInsert[] {
  return rows.map((row) => ({
    name: row.name,
    sku: row.sku,
    size: row.size || null,
    variation: row.variation || null,
    price: row.price || 0,
    stock: row.stock || 0,
  }));
}
