import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatMilliunits, getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';
import { formatDeleteTransactionResponse } from '../formatters.js';

const paramsSchema = Type.Object({
  budgetId: Type.String({ description: 'The UUID of the YNAB budget' }),
  transactionId: Type.String({ description: 'The ID of the transaction to delete' })
});

export default function createTool(ynabAPI: ynab.API): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_delete_transaction',
    label: 'Delete YNAB Transaction',
    description: 'Deletes a transaction from a YNAB budget.',
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      try {
        let existingTransaction: ynab.TransactionDetail;
        try {
          const response = await ynabAPI.transactions.getTransactionById(
            params.budgetId,
            params.transactionId
          );
          existingTransaction = response.data.transaction;
        }
        catch (error) {
          if (isYnabNotFoundError(error)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Transaction ${params.transactionId} was already deleted or did not exist.`
                }
              ],
              details: {}
            };
          }
          throw error;
        }

        const { date, amount, payee_name, category_name, memo } = existingTransaction;

        await ynabAPI.transactions.deleteTransaction(params.budgetId, params.transactionId);

        const text = formatDeleteTransactionResponse(
          params.transactionId,
          date,
          formatMilliunits(amount),
          payee_name ?? '(none)',
          category_name ?? null,
          memo ?? null
        );
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
              text: `Error: Failed to delete transaction from YNAB.\n${message}`
            }
          ],
          details: {}
        };
      }
    }
  };
}
