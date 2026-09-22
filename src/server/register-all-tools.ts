import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CreateInvoiceTool } from "../tools/create-invoice.tool.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { registerConnectCompanyApp } from "../mcp-apps/connect-company-app.js";
import { TOOL_GROUPS, ToolGroup, getEnabledToolGroups, selectEnabledTools } from "../config/tool-groups.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { ReadInvoiceTool } from "../tools/read-invoice.tool.js";
import { SearchInvoicesTool } from "../tools/search-invoices.tool.js";
import { UpdateInvoiceTool } from "../tools/update-invoice.tool.js";
import { GetInvoicePdfTool } from "../tools/get-invoice-pdf.tool.js";
import { CreateAccountTool } from "../tools/create-account.tool.js";
import { UpdateAccountTool } from "../tools/update-account.tool.js";
import { SearchAccountsTool } from "../tools/search-accounts.tool.js";
import { ReadItemTool } from "../tools/read-item.tool.js";
import { SearchItemsTool } from "../tools/search-items.tool.js";
import { CreateItemTool } from "../tools/create-item.tool.js";
import { UpdateItemTool } from "../tools/update-item.tool.js";
import { DeleteItemTool } from "../tools/delete-item.tool.js";
import { GetAccountTool } from "../tools/get-account.tool.js";
import { DeleteInvoiceTool } from "../tools/delete-invoice.tool.js";
import { CreateCustomerTool } from "../tools/create-customer.tool.js";
import { GetCustomerTool } from "../tools/get-customer.tool.js";
import { UpdateCustomerTool } from "../tools/update-customer.tool.js";
import { DeleteCustomerTool } from "../tools/delete-customer.tool.js";
import { CreateEstimateTool } from "../tools/create-estimate.tool.js";
import { GetEstimateTool } from "../tools/get-estimate.tool.js";
import { UpdateEstimateTool } from "../tools/update-estimate.tool.js";
import { DeleteEstimateTool } from "../tools/delete-estimate.tool.js";
import { SearchCustomersTool } from "../tools/search-customers.tool.js";
import { SearchEstimatesTool } from "../tools/search-estimates.tool.js";
import { CreateBillTool } from "../tools/create-bill.tool.js";
import { UpdateBillTool } from "../tools/update-bill.tool.js";
import { DeleteBillTool } from "../tools/delete-bill.tool.js";
import { GetBillTool } from "../tools/get-bill.tool.js";
import { CreateVendorTool } from "../tools/create-vendor.tool.js";
import { UpdateVendorTool } from "../tools/update-vendor.tool.js";
import { DeleteVendorTool } from "../tools/delete-vendor.tool.js";
import { GetVendorTool } from "../tools/get-vendor.tool.js";
import { SearchBillsTool } from "../tools/search-bills.tool.js";
import { SearchVendorsTool } from "../tools/search-vendors.tool.js";

// Employee tools
import { CreateEmployeeTool } from "../tools/create-employee.tool.js";
import { GetEmployeeTool } from "../tools/get-employee.tool.js";
import { UpdateEmployeeTool } from "../tools/update-employee.tool.js";
import { SearchEmployeesTool } from "../tools/search-employees.tool.js";
import { DeleteEmployeeTool } from "../tools/delete-employee.tool.js";

// Journal Entry tools
import { CreateJournalEntryTool } from "../tools/create-journal-entry.tool.js";
import { GetJournalEntryTool } from "../tools/get-journal-entry.tool.js";
import { UpdateJournalEntryTool } from "../tools/update-journal-entry.tool.js";
import { DeleteJournalEntryTool } from "../tools/delete-journal-entry.tool.js";
import { SearchJournalEntriesTool } from "../tools/search-journal-entries.tool.js";

// Bill Payment tools
import { CreateBillPaymentTool } from "../tools/create-bill-payment.tool.js";
import { GetBillPaymentTool } from "../tools/get-bill-payment.tool.js";
import { UpdateBillPaymentTool } from "../tools/update-bill-payment.tool.js";
import { DeleteBillPaymentTool } from "../tools/delete-bill-payment.tool.js";
import { SearchBillPaymentsTool } from "../tools/search-bill-payments.tool.js";

// Purchase tools
import { CreatePurchaseTool } from "../tools/create-purchase.tool.js";
import { GetPurchaseTool } from "../tools/get-purchase.tool.js";
import { UpdatePurchaseTool } from "../tools/update-purchase.tool.js";
import { DeletePurchaseTool } from "../tools/delete-purchase.tool.js";
import { SearchPurchasesTool } from "../tools/search-purchases.tool.js";

// Payment tools
import { CreatePaymentTool } from "../tools/create-payment.tool.js";
import { GetPaymentTool } from "../tools/get-payment.tool.js";
import { UpdatePaymentTool } from "../tools/update-payment.tool.js";
import { DeletePaymentTool } from "../tools/delete-payment.tool.js";
import { SearchPaymentsTool } from "../tools/search-payments.tool.js";

// Sales Receipt tools
import { CreateSalesReceiptTool } from "../tools/create-sales-receipt.tool.js";
import { GetSalesReceiptTool } from "../tools/get-sales-receipt.tool.js";
import { UpdateSalesReceiptTool } from "../tools/update-sales-receipt.tool.js";
import { DeleteSalesReceiptTool } from "../tools/delete-sales-receipt.tool.js";
import { SearchSalesReceiptsTool } from "../tools/search-sales-receipts.tool.js";

// Credit Memo tools
import { CreateCreditMemoTool } from "../tools/create-credit-memo.tool.js";
import { GetCreditMemoTool } from "../tools/get-credit-memo.tool.js";
import { UpdateCreditMemoTool } from "../tools/update-credit-memo.tool.js";
import { DeleteCreditMemoTool } from "../tools/delete-credit-memo.tool.js";
import { SearchCreditMemosTool } from "../tools/search-credit-memos.tool.js";

// Refund Receipt tools
import { CreateRefundReceiptTool } from "../tools/create-refund-receipt.tool.js";
import { GetRefundReceiptTool } from "../tools/get-refund-receipt.tool.js";
import { UpdateRefundReceiptTool } from "../tools/update-refund-receipt.tool.js";
import { DeleteRefundReceiptTool } from "../tools/delete-refund-receipt.tool.js";
import { SearchRefundReceiptsTool } from "../tools/search-refund-receipts.tool.js";

// Purchase Order tools
import { CreatePurchaseOrderTool } from "../tools/create-purchase-order.tool.js";
import { GetPurchaseOrderTool } from "../tools/get-purchase-order.tool.js";
import { UpdatePurchaseOrderTool } from "../tools/update-purchase-order.tool.js";
import { DeletePurchaseOrderTool } from "../tools/delete-purchase-order.tool.js";
import { SearchPurchaseOrdersTool } from "../tools/search-purchase-orders.tool.js";

// Vendor Credit tools
import { CreateVendorCreditTool } from "../tools/create-vendor-credit.tool.js";
import { GetVendorCreditTool } from "../tools/get-vendor-credit.tool.js";
import { UpdateVendorCreditTool } from "../tools/update-vendor-credit.tool.js";
import { DeleteVendorCreditTool } from "../tools/delete-vendor-credit.tool.js";
import { SearchVendorCreditsTool } from "../tools/search-vendor-credits.tool.js";

// Deposit tools
import { CreateDepositTool } from "../tools/create-deposit.tool.js";
import { GetDepositTool } from "../tools/get-deposit.tool.js";
import { UpdateDepositTool } from "../tools/update-deposit.tool.js";
import { DeleteDepositTool } from "../tools/delete-deposit.tool.js";
import { SearchDepositsTool } from "../tools/search-deposits.tool.js";

// Transfer tools
import { CreateTransferTool } from "../tools/create-transfer.tool.js";
import { GetTransferTool } from "../tools/get-transfer.tool.js";
import { UpdateTransferTool } from "../tools/update-transfer.tool.js";
import { DeleteTransferTool } from "../tools/delete-transfer.tool.js";
import { SearchTransfersTool } from "../tools/search-transfers.tool.js";

// Time Activity tools
import { CreateTimeActivityTool } from "../tools/create-time-activity.tool.js";
import { GetTimeActivityTool } from "../tools/get-time-activity.tool.js";
import { UpdateTimeActivityTool } from "../tools/update-time-activity.tool.js";
import { DeleteTimeActivityTool } from "../tools/delete-time-activity.tool.js";
import { SearchTimeActivitiesTool } from "../tools/search-time-activities.tool.js";

// Class tools
import { CreateClassTool } from "../tools/create-class.tool.js";
import { GetClassTool } from "../tools/get-class.tool.js";
import { UpdateClassTool } from "../tools/update-class.tool.js";
import { SearchClassesTool } from "../tools/search-classes.tool.js";

// Department tools
import { CreateDepartmentTool } from "../tools/create-department.tool.js";
import { GetDepartmentTool } from "../tools/get-department.tool.js";
import { UpdateDepartmentTool } from "../tools/update-department.tool.js";
import { SearchDepartmentsTool } from "../tools/search-departments.tool.js";

// Term tools
import { CreateTermTool } from "../tools/create-term.tool.js";
import { GetTermTool } from "../tools/get-term.tool.js";
import { UpdateTermTool } from "../tools/update-term.tool.js";
import { SearchTermsTool } from "../tools/search-terms.tool.js";

// Payment Method tools
import { CreatePaymentMethodTool } from "../tools/create-payment-method.tool.js";
import { GetPaymentMethodTool } from "../tools/get-payment-method.tool.js";
import { UpdatePaymentMethodTool } from "../tools/update-payment-method.tool.js";
import { SearchPaymentMethodsTool } from "../tools/search-payment-methods.tool.js";

// Budget tools (read-only in QBO v3 API)
import { SearchBudgetsTool } from "../tools/search-budgets.tool.js";

// Tax Code tools
import { GetTaxCodeTool } from "../tools/get-tax-code.tool.js";
import { SearchTaxCodesTool } from "../tools/search-tax-codes.tool.js";

// Tax Rate tools
import { GetTaxRateTool } from "../tools/get-tax-rate.tool.js";
import { SearchTaxRatesTool } from "../tools/search-tax-rates.tool.js";

// Tax Agency tools
import { GetTaxAgencyTool } from "../tools/get-tax-agency.tool.js";
import { SearchTaxAgenciesTool } from "../tools/search-tax-agencies.tool.js";

// Company Info tools
import { GetCompanyInfoTool } from "../tools/get-company-info.tool.js";
import { UpdateCompanyInfoTool } from "../tools/update-company-info.tool.js";

// Preferences tools
import { GetPreferencesTool } from "../tools/get-preferences.tool.js";

// Company discovery (issue #9)
import { ListCompaniesTool } from "../tools/list-companies.tool.js";
import { AuthorizeCompanyTool } from "../tools/authorize-company.tool.js";

// Attachable tools
import { CreateAttachableTool } from "../tools/create-attachable.tool.js";
import { GetAttachableTool } from "../tools/get-attachable.tool.js";
import { UpdateAttachableTool } from "../tools/update-attachable.tool.js";
import { DeleteAttachableTool } from "../tools/delete-attachable.tool.js";
import { SearchAttachablesTool } from "../tools/search-attachables.tool.js";

// Financial Report tools
import { GetBalanceSheetTool } from "../tools/get-balance-sheet.tool.js";
import { GetProfitAndLossTool } from "../tools/get-profit-and-loss.tool.js";
import { GetCashFlowTool } from "../tools/get-cash-flow.tool.js";
import { GetTrialBalanceTool } from "../tools/get-trial-balance.tool.js";
import { GetGeneralLedgerTool } from "../tools/get-general-ledger.tool.js";

// Sales/AR Report tools
import { GetCustomerSalesTool } from "../tools/get-customer-sales.tool.js";
import { GetAgedReceivablesTool } from "../tools/get-aged-receivables.tool.js";
import { GetCustomerBalanceTool } from "../tools/get-customer-balance.tool.js";

// Expense/AP Report tools
import { GetAgedPayablesTool } from "../tools/get-aged-payables.tool.js";
import { GetVendorExpensesTool } from "../tools/get-vendor-expenses.tool.js";
import { GetVendorBalanceTool } from "../tools/get-vendor-balance.tool.js";

/**
 * Every tool this server can register, tagged with the tool group (see
 * ../config/tool-groups.ts) it belongs to. This is the single source of
 * truth for both the full tool surface and its grouping - which tools
 * `registerAllTools` actually registers is filtered from this list by the
 * enabled tool groups.
 */
const TOOL_REGISTRY: ReadonlyArray<{ tool: ToolDefinition<any>; group: ToolGroup }> = [
  // Customers
  { tool: CreateCustomerTool, group: TOOL_GROUPS.CUSTOMERS },
  { tool: GetCustomerTool, group: TOOL_GROUPS.CUSTOMERS },
  { tool: UpdateCustomerTool, group: TOOL_GROUPS.CUSTOMERS },
  { tool: DeleteCustomerTool, group: TOOL_GROUPS.CUSTOMERS },
  { tool: SearchCustomersTool, group: TOOL_GROUPS.CUSTOMERS },

  // Estimates
  { tool: CreateEstimateTool, group: TOOL_GROUPS.ESTIMATES },
  { tool: GetEstimateTool, group: TOOL_GROUPS.ESTIMATES },
  { tool: UpdateEstimateTool, group: TOOL_GROUPS.ESTIMATES },
  { tool: DeleteEstimateTool, group: TOOL_GROUPS.ESTIMATES },
  { tool: SearchEstimatesTool, group: TOOL_GROUPS.ESTIMATES },

  // Bills
  { tool: CreateBillTool, group: TOOL_GROUPS.BILLS },
  { tool: UpdateBillTool, group: TOOL_GROUPS.BILLS },
  { tool: DeleteBillTool, group: TOOL_GROUPS.BILLS },
  { tool: GetBillTool, group: TOOL_GROUPS.BILLS },
  { tool: SearchBillsTool, group: TOOL_GROUPS.BILLS },

  // Invoices
  { tool: ReadInvoiceTool, group: TOOL_GROUPS.INVOICES },
  { tool: SearchInvoicesTool, group: TOOL_GROUPS.INVOICES },
  { tool: CreateInvoiceTool, group: TOOL_GROUPS.INVOICES },
  { tool: UpdateInvoiceTool, group: TOOL_GROUPS.INVOICES },
  { tool: DeleteInvoiceTool, group: TOOL_GROUPS.INVOICES },
  { tool: GetInvoicePdfTool, group: TOOL_GROUPS.INVOICES },

  // Chart of accounts
  { tool: CreateAccountTool, group: TOOL_GROUPS.ACCOUNTS },
  { tool: GetAccountTool, group: TOOL_GROUPS.ACCOUNTS },
  { tool: UpdateAccountTool, group: TOOL_GROUPS.ACCOUNTS },
  { tool: SearchAccountsTool, group: TOOL_GROUPS.ACCOUNTS },

  // Items
  { tool: ReadItemTool, group: TOOL_GROUPS.ITEMS },
  { tool: SearchItemsTool, group: TOOL_GROUPS.ITEMS },
  { tool: CreateItemTool, group: TOOL_GROUPS.ITEMS },
  { tool: UpdateItemTool, group: TOOL_GROUPS.ITEMS },
  { tool: DeleteItemTool, group: TOOL_GROUPS.ITEMS },

  // Vendors
  { tool: CreateVendorTool, group: TOOL_GROUPS.VENDORS },
  { tool: UpdateVendorTool, group: TOOL_GROUPS.VENDORS },
  { tool: DeleteVendorTool, group: TOOL_GROUPS.VENDORS },
  { tool: GetVendorTool, group: TOOL_GROUPS.VENDORS },
  { tool: SearchVendorsTool, group: TOOL_GROUPS.VENDORS },

  // Employees
  { tool: CreateEmployeeTool, group: TOOL_GROUPS.EMPLOYEES },
  { tool: GetEmployeeTool, group: TOOL_GROUPS.EMPLOYEES },
  { tool: UpdateEmployeeTool, group: TOOL_GROUPS.EMPLOYEES },
  { tool: DeleteEmployeeTool, group: TOOL_GROUPS.EMPLOYEES },
  { tool: SearchEmployeesTool, group: TOOL_GROUPS.EMPLOYEES },

  // Journal entries
  { tool: CreateJournalEntryTool, group: TOOL_GROUPS.JOURNAL_ENTRIES },
  { tool: GetJournalEntryTool, group: TOOL_GROUPS.JOURNAL_ENTRIES },
  { tool: UpdateJournalEntryTool, group: TOOL_GROUPS.JOURNAL_ENTRIES },
  { tool: DeleteJournalEntryTool, group: TOOL_GROUPS.JOURNAL_ENTRIES },
  { tool: SearchJournalEntriesTool, group: TOOL_GROUPS.JOURNAL_ENTRIES },

  // Bill payments (part of the payments workflow)
  { tool: CreateBillPaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: GetBillPaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: UpdateBillPaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: DeleteBillPaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: SearchBillPaymentsTool, group: TOOL_GROUPS.PAYMENTS },

  // Purchases
  { tool: CreatePurchaseTool, group: TOOL_GROUPS.PURCHASES },
  { tool: GetPurchaseTool, group: TOOL_GROUPS.PURCHASES },
  { tool: UpdatePurchaseTool, group: TOOL_GROUPS.PURCHASES },
  { tool: DeletePurchaseTool, group: TOOL_GROUPS.PURCHASES },
  { tool: SearchPurchasesTool, group: TOOL_GROUPS.PURCHASES },

  // Payments
  { tool: CreatePaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: GetPaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: UpdatePaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: DeletePaymentTool, group: TOOL_GROUPS.PAYMENTS },
  { tool: SearchPaymentsTool, group: TOOL_GROUPS.PAYMENTS },

  // Sales receipts
  { tool: CreateSalesReceiptTool, group: TOOL_GROUPS.SALES_RECEIPTS },
  { tool: GetSalesReceiptTool, group: TOOL_GROUPS.SALES_RECEIPTS },
  { tool: UpdateSalesReceiptTool, group: TOOL_GROUPS.SALES_RECEIPTS },
  { tool: DeleteSalesReceiptTool, group: TOOL_GROUPS.SALES_RECEIPTS },
  { tool: SearchSalesReceiptsTool, group: TOOL_GROUPS.SALES_RECEIPTS },

  // Credit memos
  { tool: CreateCreditMemoTool, group: TOOL_GROUPS.CREDIT_MEMOS },
  { tool: GetCreditMemoTool, group: TOOL_GROUPS.CREDIT_MEMOS },
  { tool: UpdateCreditMemoTool, group: TOOL_GROUPS.CREDIT_MEMOS },
  { tool: DeleteCreditMemoTool, group: TOOL_GROUPS.CREDIT_MEMOS },
  { tool: SearchCreditMemosTool, group: TOOL_GROUPS.CREDIT_MEMOS },

  // Refund receipts
  { tool: CreateRefundReceiptTool, group: TOOL_GROUPS.REFUND_RECEIPTS },
  { tool: GetRefundReceiptTool, group: TOOL_GROUPS.REFUND_RECEIPTS },
  { tool: UpdateRefundReceiptTool, group: TOOL_GROUPS.REFUND_RECEIPTS },
  { tool: DeleteRefundReceiptTool, group: TOOL_GROUPS.REFUND_RECEIPTS },
  { tool: SearchRefundReceiptsTool, group: TOOL_GROUPS.REFUND_RECEIPTS },

  // Purchase orders
  { tool: CreatePurchaseOrderTool, group: TOOL_GROUPS.PURCHASE_ORDERS },
  { tool: GetPurchaseOrderTool, group: TOOL_GROUPS.PURCHASE_ORDERS },
  { tool: UpdatePurchaseOrderTool, group: TOOL_GROUPS.PURCHASE_ORDERS },
  { tool: DeletePurchaseOrderTool, group: TOOL_GROUPS.PURCHASE_ORDERS },
  { tool: SearchPurchaseOrdersTool, group: TOOL_GROUPS.PURCHASE_ORDERS },

  // Vendor credits
  { tool: CreateVendorCreditTool, group: TOOL_GROUPS.VENDOR_CREDITS },
  { tool: GetVendorCreditTool, group: TOOL_GROUPS.VENDOR_CREDITS },
  { tool: UpdateVendorCreditTool, group: TOOL_GROUPS.VENDOR_CREDITS },
  { tool: DeleteVendorCreditTool, group: TOOL_GROUPS.VENDOR_CREDITS },
  { tool: SearchVendorCreditsTool, group: TOOL_GROUPS.VENDOR_CREDITS },

  // Deposits
  { tool: CreateDepositTool, group: TOOL_GROUPS.DEPOSITS },
  { tool: GetDepositTool, group: TOOL_GROUPS.DEPOSITS },
  { tool: UpdateDepositTool, group: TOOL_GROUPS.DEPOSITS },
  { tool: DeleteDepositTool, group: TOOL_GROUPS.DEPOSITS },
  { tool: SearchDepositsTool, group: TOOL_GROUPS.DEPOSITS },

  // Transfers
  { tool: CreateTransferTool, group: TOOL_GROUPS.TRANSFERS },
  { tool: GetTransferTool, group: TOOL_GROUPS.TRANSFERS },
  { tool: UpdateTransferTool, group: TOOL_GROUPS.TRANSFERS },
  { tool: DeleteTransferTool, group: TOOL_GROUPS.TRANSFERS },
  { tool: SearchTransfersTool, group: TOOL_GROUPS.TRANSFERS },

  // Time activities
  { tool: CreateTimeActivityTool, group: TOOL_GROUPS.TIME_ACTIVITIES },
  { tool: GetTimeActivityTool, group: TOOL_GROUPS.TIME_ACTIVITIES },
  { tool: UpdateTimeActivityTool, group: TOOL_GROUPS.TIME_ACTIVITIES },
  { tool: DeleteTimeActivityTool, group: TOOL_GROUPS.TIME_ACTIVITIES },
  { tool: SearchTimeActivitiesTool, group: TOOL_GROUPS.TIME_ACTIVITIES },

  // Classes (load-bearing for fund accounting - enabled by default)
  { tool: CreateClassTool, group: TOOL_GROUPS.CLASSES },
  { tool: GetClassTool, group: TOOL_GROUPS.CLASSES },
  { tool: UpdateClassTool, group: TOOL_GROUPS.CLASSES },
  { tool: SearchClassesTool, group: TOOL_GROUPS.CLASSES },

  // Departments (load-bearing for fund accounting - enabled by default)
  { tool: CreateDepartmentTool, group: TOOL_GROUPS.DEPARTMENTS },
  { tool: GetDepartmentTool, group: TOOL_GROUPS.DEPARTMENTS },
  { tool: UpdateDepartmentTool, group: TOOL_GROUPS.DEPARTMENTS },
  { tool: SearchDepartmentsTool, group: TOOL_GROUPS.DEPARTMENTS },

  // Terms
  { tool: CreateTermTool, group: TOOL_GROUPS.TERMS },
  { tool: GetTermTool, group: TOOL_GROUPS.TERMS },
  { tool: UpdateTermTool, group: TOOL_GROUPS.TERMS },
  { tool: SearchTermsTool, group: TOOL_GROUPS.TERMS },

  // Payment methods
  { tool: CreatePaymentMethodTool, group: TOOL_GROUPS.PAYMENT_METHODS },
  { tool: GetPaymentMethodTool, group: TOOL_GROUPS.PAYMENT_METHODS },
  { tool: UpdatePaymentMethodTool, group: TOOL_GROUPS.PAYMENT_METHODS },
  { tool: SearchPaymentMethodsTool, group: TOOL_GROUPS.PAYMENT_METHODS },

  // Budgets (read-only)
  { tool: SearchBudgetsTool, group: TOOL_GROUPS.BUDGETS },

  // Tax codes
  { tool: GetTaxCodeTool, group: TOOL_GROUPS.TAX_CODES },
  { tool: SearchTaxCodesTool, group: TOOL_GROUPS.TAX_CODES },

  // Tax rates
  { tool: GetTaxRateTool, group: TOOL_GROUPS.TAX_RATES },
  { tool: SearchTaxRatesTool, group: TOOL_GROUPS.TAX_RATES },

  // Tax agencies
  { tool: GetTaxAgencyTool, group: TOOL_GROUPS.TAX_AGENCIES },
  { tool: SearchTaxAgenciesTool, group: TOOL_GROUPS.TAX_AGENCIES },

  // Company info
  { tool: GetCompanyInfoTool, group: TOOL_GROUPS.COMPANY_INFO },
  { tool: UpdateCompanyInfoTool, group: TOOL_GROUPS.COMPANY_INFO },

  // Preferences
  { tool: GetPreferencesTool, group: TOOL_GROUPS.PREFERENCES },

  // Company discovery
  { tool: ListCompaniesTool, group: TOOL_GROUPS.COMPANIES },
  { tool: AuthorizeCompanyTool, group: TOOL_GROUPS.COMPANIES },

  // Attachables
  { tool: CreateAttachableTool, group: TOOL_GROUPS.ATTACHABLES },
  { tool: GetAttachableTool, group: TOOL_GROUPS.ATTACHABLES },
  { tool: UpdateAttachableTool, group: TOOL_GROUPS.ATTACHABLES },
  { tool: DeleteAttachableTool, group: TOOL_GROUPS.ATTACHABLES },
  { tool: SearchAttachablesTool, group: TOOL_GROUPS.ATTACHABLES },

  // Financial reports
  { tool: GetBalanceSheetTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetProfitAndLossTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetCashFlowTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetTrialBalanceTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetGeneralLedgerTool, group: TOOL_GROUPS.REPORTS },

  // Sales/AR reports
  { tool: GetCustomerSalesTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetAgedReceivablesTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetCustomerBalanceTool, group: TOOL_GROUPS.REPORTS },

  // Expense/AP reports
  { tool: GetAgedPayablesTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetVendorExpensesTool, group: TOOL_GROUPS.REPORTS },
  { tool: GetVendorBalanceTool, group: TOOL_GROUPS.REPORTS },
];

/**
 * Registers every enabled QuickBooks tool on the given MCP server. Shared by
 * the stdio entry point (src/index.ts) and the streamable HTTP application
 * (src/http/create-streamable-http-server.ts) so both transports expose the
 * same tool surface from one place.
 *
 * Which tools are enabled is configuration (issue #11): TOOL_REGISTRY tags
 * every tool with a group, and only tools in an enabled group (see
 * ../config/tool-groups.ts, QUICKBOOKS_ENABLED_TOOL_GROUPS) reach
 * RegisterTool - a disabled tool's definition is never handed to the MCP
 * SDK, so it is absent from the tool listing entirely, not merely hidden
 * behind a runtime check. The existing per-CRUD-category disable flags
 * (QUICKBOOKS_DISABLE_WRITE/UPDATE/DELETE) are unaffected: they are still
 * enforced inside RegisterTool itself for every tool that reaches it.
 */
export function registerAllTools(server: McpServer): void {
  // The Company-connection MCP App (issue #28). Registered unconditionally,
  // not behind a tool group: it is a resource rather than a tool, and both
  // tools that point at it (authorize_company, and any tool tripping the
  // authorization checkpoint) can only render if it is there to be read.
  registerConnectCompanyApp(server);

  const enabledGroups = getEnabledToolGroups();
  for (const tool of selectEnabledTools(TOOL_REGISTRY, enabledGroups)) {
    RegisterTool(server, tool);
  }
}
