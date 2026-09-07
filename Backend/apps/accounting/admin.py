from django.contrib import admin

from .models import Account, AccountMap, FiscalYear, Period


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "root_type", "account_type", "is_group", "is_active"]
    list_filter = ["root_type", "account_type", "is_group", "is_active"]
    search_fields = ["code", "name", "name_ar"]
    raw_id_fields = ["parent"]


@admin.register(AccountMap)
class AccountMapAdmin(admin.ModelAdmin):
    list_display = ["purpose", "qualifier", "account"]
    search_fields = ["purpose", "qualifier", "account__code", "account__name"]
    raw_id_fields = ["account"]


@admin.register(FiscalYear)
class FiscalYearAdmin(admin.ModelAdmin):
    list_display = ["name", "start_date", "end_date", "status"]
    list_filter = ["status"]


@admin.register(Period)
class PeriodAdmin(admin.ModelAdmin):
    list_display = ["name", "fiscal_year", "start_date", "end_date", "status"]
    list_filter = ["status", "fiscal_year"]
