#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BICEP_FILE="$ROOT_DIR/infra/main.bicep"
PARAMETERS_FILE="${1:-$ROOT_DIR/infra/parameters/dev.parameters.local.json}"

: "${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the target subscription ID}"
: "${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to a dedicated signature resource group}"
: "${AZURE_LOCATION:?Set AZURE_LOCATION to a region supported by Static Web Apps}"

if [[ ! -f "$PARAMETERS_FILE" ]]; then
  printf 'Parameters file not found: %s\nCopy infra/parameters/dev.parameters.example.json to infra/parameters/dev.parameters.local.json and fill in the IDs.\n' "$PARAMETERS_FILE" >&2
  exit 2
fi

az account set --subscription "$AZURE_SUBSCRIPTION_ID"

if ! az group show --name "$AZURE_RESOURCE_GROUP" --output none 2>/dev/null; then
  az group create \
    --name "$AZURE_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --output none
fi

DEPLOYMENT_NAME="signature-foundation-$(date -u +%Y%m%d%H%M%S)"
PARAMETERS=("@$PARAMETERS_FILE")

az deployment group validate \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "${DEPLOYMENT_NAME}-validate" \
  --mode Incremental \
  --template-file "$BICEP_FILE" \
  --parameters "${PARAMETERS[@]}" \
  --output none

az deployment group what-if \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "${DEPLOYMENT_NAME}-whatif" \
  --mode Incremental \
  --template-file "$BICEP_FILE" \
  --parameters "${PARAMETERS[@]}"

read -r -p "Deploy to dedicated resource group '$AZURE_RESOURCE_GROUP'? Type 'deploy' to continue: " confirmation
if [[ "$confirmation" != 'deploy' ]]; then
  printf 'Deployment cancelled.\n'
  exit 0
fi

if ! az deployment group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$DEPLOYMENT_NAME" \
  --mode Incremental \
  --template-file "$BICEP_FILE" \
  --parameters "${PARAMETERS[@]}"; then
  printf '\nDeployment failed. The script did not delete resources or attempt an automatic complete-mode rollback.\n' >&2
  printf 'Review deployment operations, then use scripts/rollback-azure.sh with the last known-good Bicep file and matching parameters.\n' >&2
  exit 1
fi