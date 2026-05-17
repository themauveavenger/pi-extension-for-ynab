import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { formatCategoriesResponse } from '../formatters.js';
import { getCurrentBudgetMonth, getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })),
  month: Type.Optional(Type.String({ description: 'Budget month (YYYY-MM-01). Defaults to current month.' })),
  query: Type.Optional(Type.String({ description: 'Case-insensitive search over category and category group names.' })),
  includeHidden: Type.Optional(Type.Boolean({ description: 'If true, include hidden categories. Defaults to false.' })),
  onlyOverspent: Type.Optional(Type.Boolean({ description: 'If true, only return categories with negative available balances.' })),
  onlyAvailable: Type.Optional(Type.Boolean({ description: 'If true, only return categories with positive available balances.' })),
  includeGoals: Type.Optional(Type.Boolean({ description: 'If true, include category goal details.' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: 'Maximum categories to show. Defaults to 100.' }))
});

function matchesQuery(category: ynab.Category, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase();
  return category.name.toLocaleLowerCase().includes(normalizedQuery)
    || (category.category_group_name ?? '').toLocaleLowerCase().includes(normalizedQuery);
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_get_categories',
    label: 'Get YNAB Categories',
    description: 'Finds YNAB categories and lists assigned, activity, available, overspent status, and optional goal details.',
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
        const includeHidden = params.includeHidden ?? false;
        let categories = response.data.month.categories.filter(c => !c.deleted && (includeHidden || !c.hidden));

        if (params.query) categories = categories.filter(c => matchesQuery(c, params.query!));
        if (params.onlyOverspent) categories = categories.filter(c => c.balance < 0);
        if (params.onlyAvailable) categories = categories.filter(c => c.balance > 0);

        categories = [...categories].sort((a, b) => {
          const groupCompare = (a.category_group_name ?? '').localeCompare(b.category_group_name ?? '');
          return groupCompare === 0 ? a.name.localeCompare(b.name) : groupCompare;
        });

        const totalCount = categories.length;
        const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
        const shownCategories = categories.slice(0, limit);

        return {
          content: [{ type: 'text' as const, text: formatCategoriesResponse(response.data.month, shownCategories, totalCount, params.includeGoals ?? false) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" or month "${params.month ?? getCurrentBudgetMonth()}" not found.`
          : getYnabErrorMessage(error);
        return { content: [{ type: 'text' as const, text: `Error: Failed to fetch YNAB categories.\n${message}` }], details: {} };
      }
    }
  };
}
