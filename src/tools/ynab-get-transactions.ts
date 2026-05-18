import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { getDefaultSinceDate, getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';
import { formatTransactionsResponse } from '../formatters.js';

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  sinceDate: Type.Optional(
    Type.String({ description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.' })
  ),
  unapproved: Type.Optional(
    Type.Boolean({
      description:
        'If true, return only unapproved transactions. If false, return only approved. Omit to include both.'
    })
  ),
  uncleared: Type.Optional(
    Type.Boolean({
      description:
        'If true, return only uncleared transactions. If false, return only cleared/reconciled. Omit to include both.'
    })
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Maximum transactions to return. Defaults to 25; capped at 100.'
    })
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description: 'If true, include account, cleared/approved status, and memo fields. Defaults to false for compact output.'
    })
  )
});

export default function createTool(ynabAPI: ynab.API): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_get_transactions',
    label: 'Get YNAB Transactions',
    description:
      'Fetches transactions from a YNAB budget. Use unapproved=true to find bank imports awaiting review. Use uncleared=true to find manual entries not yet matched.',
    promptSnippet: 'List recent YNAB transactions by budget, date, approval, cleared status, and limit.',
    promptGuidelines: [
      'Use ynab_get_transactions to find transaction IDs before approving, deleting, flagging, or splitting transactions.',
      'Use ynab_get_transactions with unapproved=true when the user asks to review imported or pending YNAB transactions.',
      'Use ynab_get_transactions with verbose=true when account, memo, cleared, or approved status matters.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const sinceDate = params.sinceDate ?? getDefaultSinceDate();
        const transactionType = params.unapproved === true ? 'unapproved' : undefined;
        const response = transactionType
          ? await ynabAPI.transactions.getTransactions(params.budgetId, sinceDate, transactionType)
          : await ynabAPI.transactions.getTransactions(params.budgetId, sinceDate);
        let transactions = response.data.transactions;

        if (params.unapproved !== undefined) {
          transactions = transactions.filter(t =>
            params.unapproved ? !t.approved : t.approved
          );
        }
        if (params.uncleared !== undefined) {
          transactions = transactions.filter(t =>
            params.uncleared ? t.cleared === 'uncleared' : t.cleared !== 'uncleared'
          );
        }

        transactions = [...transactions].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        const totalCount = transactions.length;
        const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
        const shownTransactions = transactions.slice(0, limit);

        const text = formatTransactionsResponse(
          params.budgetId,
          sinceDate,
          params.unapproved,
          params.uncleared,
          shownTransactions,
          totalCount,
          limit,
          params.verbose ?? false
        );
        return {
          content: [{ type: 'text' as const, text }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Failed to fetch transactions from YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
