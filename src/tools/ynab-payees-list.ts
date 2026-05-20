import type * as ynab from 'ynab';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { getYnabErrorMessage, isYnabNotFoundError } from '../utils.js';

const paramsSchema = Type.Object({
  budgetId: Type.Optional(
    Type.String({ description: 'The UUID of the YNAB budget. Defaults from extension config or YNAB_BUDGET_ID.' })
  ),
  includeTransfers: Type.Optional(
    Type.Boolean({ description: 'If true, include transfer payees (e.g. "Transfer : Savings"). Defaults to false.' })
  ),
  includeDeleted: Type.Optional(
    Type.Boolean({ description: 'If true, include deleted payees. Defaults to false.' })
  )
});

function formatPayeesListResponse(
  budgetId: string,
  payees: ynab.Payee[],
  totalCount: number
): string {
  const lines: string[] = [
    `Payees for budget ${budgetId} (showing ${payees.length} of ${totalCount}):`
  ];

  if (payees.length === 0) {
    lines.push('(no payees match the current filters)');
    return lines.join('\n');
  }

  for (const payee of payees) {
    const flags: string[] = [];
    if (payee.transfer_account_id) flags.push('transfer');
    if (payee.deleted) flags.push('deleted');
    const suffix = flags.length > 0 ? ` | ${flags.join(', ')}` : '';
    lines.push(`- ${payee.name} (id: ${payee.id})${suffix}`);
  }

  return lines.join('\n');
}

export default function createTool(
  ynabAPI: ynab.API,
  resolveBudgetId: (budgetId?: string) => string
): ToolDefinition<typeof paramsSchema> {
  return {
    name: 'ynab_payees_list',
    label: 'List YNAB Payees',
    description:
      'Lists payees in a YNAB budget. Defaults to non-deleted, non-transfer payees. Use before creating or editing transactions to discover exact payee names.',
    promptSnippet: 'List YNAB payees with names and IDs. Supports filtering transfers and deleted payees.',
    promptGuidelines: [
      'Use ynab_payees_list before creating or editing transactions when the exact payee name is uncertain.',
      'Use ynab_payees_list to discover payee IDs for programmatic use.',
      'Use ynab_payees_list with includeTransfers=true only when the user asks about transfer payees.'
    ],
    parameters: paramsSchema,
    async execute(_toolCallId, params) {
      let budgetId: string;
      try {
        budgetId = resolveBudgetId(params.budgetId);
      }
      catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${String(error instanceof Error ? error.message : error)}` }],
          details: {}
        };
      }

      try {
        const response = await ynabAPI.payees.getPayees(budgetId);
        let payees = response.data.payees;

        if (!(params.includeDeleted ?? false)) {
          payees = payees.filter(p => !p.deleted);
        }
        if (!(params.includeTransfers ?? false)) {
          payees = payees.filter(p => !p.transfer_account_id);
        }

        payees = [...payees].sort((a, b) => a.name.localeCompare(b.name));

        return {
          content: [{ type: 'text' as const, text: formatPayeesListResponse(budgetId, payees, response.data.payees.length) }],
          details: {}
        };
      }
      catch (error) {
        const message = isYnabNotFoundError(error)
          ? `Budget "${budgetId}" not found. Verify the budget ID.`
          : getYnabErrorMessage(error);
        return {
          content: [{ type: 'text' as const, text: `Error: Failed to fetch YNAB payees.\n${message}` }],
          details: {}
        };
      }
    }
  };
}
