import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatBudgetMonthResponse } from '../formatters.js';
import { getCurrentBudgetMonth, getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  month: Type.Optional(Type.String({ description: 'Budget month (YYYY-MM-01). Defaults to current month.' }))
});

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_get_budget_month',
    label: 'Get YNAB Budget Month',
    description: 'Fetches high-level budget month status, including Ready to Assign and category availability counts.',
    promptSnippet: 'Summarize a YNAB budget month: Ready to Assign, assigned, activity, overspending, and available funds.',
    promptGuidelines: [
      'Use ynab_get_budget_month before budgeting changes when the user asks for month-level budget status.',
      'Use ynab_get_budget_month to check Ready to Assign and overspent category counts before assigning or moving money.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }], details: {} };
      }

      try {
        const month = params.month ?? getCurrentBudgetMonth();
        const response = await ynabAPI.months.getPlanMonth(budgetId, month);
        return {
          content: [{ type: 'text' as const, text: formatBudgetMonthResponse(response.data.month) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" or month "${params.month ?? getCurrentBudgetMonth()}" not found.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to fetch YNAB budget month.\n${message}` }], details: {} };
      }
    }
  };
}
