import Table from 'cli-table3';

export function makeTable(head: string[]): Table.Table {
  return new Table({ head, style: { head: ['cyan'] } });
}
