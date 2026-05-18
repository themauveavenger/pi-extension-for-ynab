import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatMilliunits, getYnabErrorMessage, isYnabNotFoundError, milliunitsToCurrency, validateAndResolveSplits, ynabCurrency } from '../utils.js';
import { formatSplitTransactionResponse } from '../formatters.js';

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  transactionId: Type.String({ description: 'The ID of the transaction to split' }),
  splits: Type.Array(
    Type.Object({
      category: Type.String({ description: 'Category name for this split' }),
      amount: Type.Union([Type.Number(), Type.Null()], { description: 'Amount in dollars, or null to calculate from remainder' }),
      memo: Type.Optional(Type.String({ description: 'Optional memo for this split' }))
    }),
    { minItems: 2, description: 'At least 2 splits to divide the transaction' }
  )
});

export default function createTool(ynabAPI: ynab.API): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_split_transaction',
    label: 'Split YNAB Transaction',
    description:
      'Splits an existing YNAB transaction into multiple categories. The transaction must not already be split.',
    promptSnippet: 'Split an existing unsplit YNAB transaction into multiple categories.',
    promptGuidelines: [
      'Use ynab_split_transaction only after identifying the transaction ID with ynab_get_transactions or user-provided evidence.',
      'Use ynab_split_transaction only for existing transactions that are not already split.',
      'For ynab_split_transaction, provide at least two category splits and use at most one null amount for the calculated remainder.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        const transactionResponse = await ynabAPI.transactions.getTransactionById(
          params.budgetId,
          params.transactionId
        );
        const existingTransaction = transactionResponse.data.transaction;

        if (existingTransaction.subtransactions && existingTransaction.subtransactions.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Cannot split transaction ${params.transactionId}.\nThis transaction is already split. Delete and recreate it to change splits.`
              }
            ],
            details: {}
          };
        }

        const totalAmount = milliunitsToCurrency(existingTransaction.amount);
        const splitInputs = params.splits.map(s => ({
          category: s.category,
          amount: s.amount === null ? null : ynabCurrency(s.amount),
          memo: s.memo
        }));

        const result = await validateAndResolveSplits(ynabAPI, params.budgetId, totalAmount, splitInputs);
        if (result.errors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Invalid split amounts.\n${result.errors.join('\n')}`
              }
            ],
            details: {}
          };
        }

        const subtransactions = result.subtransactions;

        await ynabAPI.transactions.updateTransactions(params.budgetId, {
          transactions: [
            {
              id: params.transactionId,
              category_id: null as unknown as string,
              subtransactions
            }
          ]
        });

        const splitLines = params.splits.map((split, i) => ({
          category: split.category,
          amount: formatMilliunits(subtransactions[i].amount)
        }));

        const text = formatSplitTransactionResponse(params.transactionId, splitLines);
        return {
          content: [{ type: 'text' as const, text }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${params.budgetId}" not found or transaction "${params.transactionId}" does not exist. Verify the IDs.`
          : getYnabErrorMessage(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Failed to split transaction in YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
