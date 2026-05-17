import type * as ynab from 'ynab';
import type currency from 'currency.js';
import { formatMilliunits, buildPayeeStats, daysBetween, formatUsd, milliunitsToCurrency } from './utils.js';

export function formatTransactionLine(t: ynab.TransactionDetail, verbose = false): string {
  const amount = formatMilliunits(t.amount);
  const payee = t.payee_name ?? '(none)';
  const category = t.category_name ?? '(none)';
  const base = `- ${t.id} | ${t.date} | ${amount} | ${payee} | ${category}`;

  if (!verbose) return base;

  const approved = t.approved ? 'approved' : 'unapproved';
  const memo = t.memo ? ` | memo: ${t.memo}` : '';
  return `${base} | ${t.account_name} | ${t.cleared} | ${approved}${memo}`;
}

export function formatTransactionsResponse(
  budgetId: string,
  sinceDate: string,
  unapproved: boolean | undefined,
  uncleared: boolean | undefined,
  transactions: ynab.TransactionDetail[],
  totalCount = transactions.length,
  limit = transactions.length,
  verbose = false
): string {
  const lines: string[] = [
    `Returned ${totalCount} transactions from YNAB budget ${budgetId} since ${sinceDate}. Showing ${transactions.length} of ${totalCount} (limit ${limit}).`
  ];

  const filters: string[] = [];
  if (unapproved !== undefined) filters.push(`Unapproved filter: ${unapproved}`);
  if (uncleared !== undefined) filters.push(`Uncleared filter: ${uncleared}`);
  if (filters.length > 0) {
    lines.push(filters.join(' | '));
  }

  lines.push('', 'Transactions:');
  for (const t of transactions) {
    lines.push(formatTransactionLine(t, verbose));
  }

  return lines.join('\n');
}

export function formatPayeeHistoryResponse(
  payeeName: string,
  sinceDate: string,
  stats: ReturnType<typeof buildPayeeStats>
): string {
  const today = new Date().toISOString().split('T')[0];
  const days = daysBetween(sinceDate, today);

  const lines: string[] = [
    `Payee history for "${payeeName}" over the last ${days} days.`,
    `Transactions: ${stats.transactionCount} | Total spent: ${formatMilliunits(stats.totalSpent)} | Refunds: ${stats.refundCount}`,
    `Average: ${formatMilliunits(stats.averageAmount)} | Median: ${formatMilliunits(stats.medianAmount)} | Min: ${formatMilliunits(stats.minAmount)} | Max: ${formatMilliunits(stats.maxAmount)}`
  ];

  const frequency
    = stats.frequencyDays !== null
      ? `~${stats.frequencyDays.toFixed(1)} days between visits`
      : 'N/A (insufficient data)';
  lines.push(`Std deviation: ${formatMilliunits(stats.stdDeviation)} | Frequency: ${frequency}`);
  lines.push(`Most common category: ${stats.mostCommonCategory ?? 'N/A'}`);

  lines.push('', 'Recent transactions:');
  for (const t of stats.recentTransactions) {
    lines.push(`- ${t.date} | ${formatMilliunits(t.amount)} | ${t.category_name ?? '(none)'}`);
  }

  return lines.join('\n');
}

export function formatCreateTransactionResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const lines = [`Created transaction in ${account}.`];
  const categoryText = category ?? '(none)';
  const memoText = memo ? ` | Memo: ${memo}` : '';
  lines.push(`- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`);
  return lines.join('\n');
}

export function formatCreateTransferResponse(
  fromAccount: string,
  toAccount: string,
  date: string,
  amount: string
): string {
  const lines = [
    `Created transfer from ${fromAccount} to ${toAccount}.`,
    `- Date: ${date} | Amount: ${amount} | Transfer to ${toAccount}`
  ];
  return lines.join('\n');
}

export interface SplitLine {
  category: string;
  amount: string;
}

export function formatCreateSplitResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  splits: SplitLine[]
): string {
  const lines = [
    `Created split transaction in ${account} across ${splits.length} categories.`,
    `- Date: ${date} | Amount: ${amount} | Payee: ${payee}`
  ];
  for (const split of splits) {
    lines.push(`  - ${split.category}: ${split.amount}`);
  }
  return lines.join('\n');
}

export function formatSplitTransactionResponse(
  transactionId: string,
  splits: SplitLine[]
): string {
  const lines = [`Split transaction ${transactionId} into ${splits.length} categories.`];
  for (const split of splits) {
    lines.push(`- ${split.category}: ${split.amount}`);
  }
  return lines.join('\n');
}

export function formatApproveTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? '(none)';
  const clearedText = cleared === 'uncleared' ? 'no' : 'yes';
  return `Approved transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatAlreadyApprovedResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? '(none)';
  const clearedText = cleared === 'uncleared' ? 'no' : 'yes';
  return `Transaction ${transactionId} was already approved. No changes needed.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatDeleteTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const categoryText = category ?? '(none)';
  const memoText = memo ? ` | Memo: ${memo}` : '';
  return `Deleted transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`;
}

export function formatFlagTransactionResponse(
  transactionId: string,
  flagColor: string | null,
  memo: string | null
): string {
  const memoText = memo ? `\n- Memo: ${memo}` : '';
  if (!flagColor) {
    return `Cleared flag from transaction ${transactionId}.${memoText}`;
  }
  return `Flagged transaction ${transactionId} with ${flagColor} flag.${memoText}`;
}

export function formatAlreadyFlaggedResponse(
  transactionId: string,
  flagColor: string | null
): string {
  if (!flagColor) {
    return `Transaction ${transactionId} already has no flag. No changes needed.`;
  }
  return `Transaction ${transactionId} already has the ${flagColor} flag. No changes needed.`;
}

export function formatBudgetMonthResponse(month: ynab.MonthDetail): string {
  const categories = month.categories.filter(c => !c.deleted && !c.hidden);
  const overspentCount = categories.filter(c => c.balance < 0).length;
  const availableCount = categories.filter(c => c.balance > 0).length;
  const availableToMove = categories.reduce((total, c) => total + Math.max(c.balance, 0), 0);

  return [
    `Budget month ${month.month}:`,
    `Ready to Assign: ${formatUsd(milliunitsToCurrency(month.to_be_budgeted))}`,
    `Assigned: ${formatUsd(milliunitsToCurrency(month.budgeted))}`,
    `Activity: ${formatUsd(milliunitsToCurrency(month.activity))}`,
    `Available to move: ${formatUsd(milliunitsToCurrency(availableToMove))}`,
    `Overspent categories: ${overspentCount}`,
    `Categories with funds available: ${availableCount}`
  ].join('\n');
}

export function formatCategoryLine(category: ynab.Category, includeGoals = false): string[] {
  const flags: string[] = [];
  if (category.balance < 0) flags.push('OVERSPENT');
  if (category.hidden) flags.push('HIDDEN');

  const group = category.category_group_name ?? '(no group)';
  const suffix = flags.length > 0 ? ` | ${flags.join(' | ')}` : '';
  const lines = [
    `- ${category.name} | Group: ${group} | Assigned: ${formatUsd(milliunitsToCurrency(category.budgeted))} | Activity: ${formatUsd(milliunitsToCurrency(category.activity))} | Available: ${formatUsd(milliunitsToCurrency(category.balance))}${suffix}`
  ];

  if (includeGoals) {
    const target = category.goal_target === undefined || category.goal_target === null
      ? 'none'
      : formatUsd(milliunitsToCurrency(category.goal_target));
    const underfunded = category.goal_under_funded === undefined || category.goal_under_funded === null
      ? 'n/a'
      : formatUsd(milliunitsToCurrency(category.goal_under_funded));
    const overallLeft = category.goal_overall_left === undefined || category.goal_overall_left === null
      ? 'n/a'
      : formatUsd(milliunitsToCurrency(category.goal_overall_left));
    const snoozed = category.goal_snoozed_at ? 'yes' : 'no';
    lines.push(`  Goal: ${category.goal_type ?? 'none'} | Target: ${target} | Underfunded: ${underfunded} | Overall left: ${overallLeft} | Snoozed: ${snoozed}`);
  }

  return lines;
}

export function formatCategoriesResponse(
  month: ynab.MonthDetail,
  categories: ynab.Category[],
  totalCount: number,
  includeGoals = false
): string {
  const lines = [
    `Categories for ${month.month}. Showing ${categories.length} of ${totalCount}.`,
    `Ready to Assign: ${formatUsd(milliunitsToCurrency(month.to_be_budgeted))}`,
    '',
    'Categories:'
  ];

  for (const category of categories) {
    lines.push(...formatCategoryLine(category, includeGoals));
  }

  return lines.join('\n');
}

export function formatAssignMoneyResponse(
  categoryName: string,
  month: string,
  previousAssigned: currency,
  newAssigned: currency,
  delta: currency,
  dryRun: boolean
): string {
  const prefix = dryRun ? 'Dry run: would assign money' : 'Assigned money';
  return [
    `${prefix} to ${categoryName} for ${month}.`,
    `Assigned: ${formatUsd(previousAssigned)} -> ${formatUsd(newAssigned)}`,
    `Delta: ${formatUsd(delta)}`
  ].join('\n');
}

export function formatMoveMoneyResponse(
  fromCategory: string,
  toCategory: string,
  month: string,
  amount: currency,
  dryRun: boolean
): string {
  const prefix = dryRun ? 'Dry run: would move money' : 'Moved money';
  return `${prefix} for ${month}: ${formatUsd(amount)} from ${fromCategory} to ${toCategory}.`;
}

export function formatUpdateCategoryGoalResponse(
  categoryName: string,
  dryRun: boolean,
  changes: string[]
): string {
  const prefix = dryRun ? 'Dry run: would update goal' : 'Updated goal';
  return [`${prefix} for ${categoryName}.`, ...changes.map(change => `- ${change}`)].join('\n');
}
