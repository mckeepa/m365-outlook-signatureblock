targetScope = 'resourceGroup'

@description('Azure region for most resource group resources (Function App, Cosmos DB, Storage, VNet, Log Analytics).')
param location string

@description('Azure region for the Static Web App. Static Web Apps Standard is only available in a small subset of regions (centralus, eastus2, westus2, westeurope, eastasia), which may differ from "location".')
param staticWebAppLocation string = 'eastasia'

@description('Short lowercase prefix used in globally unique resource names.')
@minLength(3)
@maxLength(5)
param namingPrefix string

@description('Entra tenant ID used by App Service authentication for the template API.')
param entraTenantId string

@description('Application (client) ID of the separate Entra app registration for the API.')
param apiApplicationClientId string

@description('Local portal origin allowed for development API calls.')
param developmentOrigin string = 'http://localhost:5173'

@description('Private address range reserved for this solution VNet. Confirm it does not overlap connected networks.')
param vnetAddressPrefix string = '10.42.0.0/16'

@description('Subnet delegated to the Function App for outbound VNet integration.')
param functionSubnetPrefix string = '10.42.1.0/24'

@description('Subnet for private endpoints.')
param privateEndpointSubnetPrefix string = '10.42.2.0/24'

@description('Retention period for successful signature-application audit records.')
@minValue(30)
@maxValue(2555)
param auditRetentionDays int = 365

@description('Tags applied to supported resources.')
param tags object = {
  application: 'outlook-signatures'
  managedBy: 'bicep'
}

var suffix = uniqueString(subscription().id, resourceGroup().id)
var staticAppName = '${namingPrefix}-${suffix}-web'
var functionAppName = '${namingPrefix}-${suffix}-api'
var cosmosAccountName = '${namingPrefix}-${suffix}-cosmos'
var storageAccountName = toLower(replace('${namingPrefix}${suffix}asset', '-', ''))
var appInsightsName = '${namingPrefix}-${suffix}-insights'
var logWorkspaceName = '${namingPrefix}-${suffix}-logs'
var vnetName = '${namingPrefix}-${suffix}-vnet'
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var privateDnsZoneNames = [
  'privatelink.documents.azure.com'
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.queue.${environment().suffixes.storage}'
  'privatelink.table.${environment().suffixes.storage}'
]

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
  }
}

resource functionSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'snet-functions'
  properties: {
    addressPrefix: functionSubnetPrefix
    delegations: [
      {
        name: 'app-service-delegation'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
  }
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'snet-private-endpoints'
  properties: {
    addressPrefix: privateEndpointSubnetPrefix
    privateEndpointNetworkPolicies: 'Disabled'
  }
}

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for zoneName in privateDnsZoneNames: {
  name: zoneName
  location: 'global'
  tags: tags
}]

resource privateDnsVnetLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (zoneName, index) in privateDnsZoneNames: {
  parent: privateDnsZones[index]
  name: '${namingPrefix}-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}]

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logWorkspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
    DisableIpMasking: true
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticAppName
  location: staticWebAppLocation
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    // Must be true: false blocks every deployment that includes staticwebapp.config.json,
    // including the first one, since the routing/auth config ships with each build.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource blobStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_ZRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Deny'
      ipRules: []
      virtualNetworkRules: []
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: blobStorage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
  }
}

resource assetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'signature-assets'
  properties: {
    publicAccess: 'None'
  }
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${namingPrefix}-${suffix}-functions'
  location: location
  kind: 'linux'
  tags: tags
  sku: {
    name: 'EP1'
    tier: 'ElasticPremium'
    size: 'EP1'
    family: 'EP'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    virtualNetworkSubnetId: functionSubnet.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      vnetRouteAllEnabled: true
      cors: {
        allowedOrigins: [
          'https://${staticWebApp.properties.defaultHostname}'
          developmentOrigin
        ]
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'AzureWebJobsStorage__accountName'
          value: blobStorage.name
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosAccount.properties.documentEndpoint
        }
        {
          name: 'COSMOS_DATABASE_NAME'
          value: 'EmailSignatures'
        }
        {
          name: 'ASSETS_BLOB_ENDPOINT'
          value: 'https://${blobStorage.name}.blob.${environment().suffixes.storage}'
        }
        {
          name: 'ASSETS_CONTAINER_NAME'
          value: assetsContainer.name
        }
        {
          name: 'API_AUTH_TENANT_ID'
          value: entraTenantId
        }
      ]
    }
  }
}

resource functionAuthSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
      excludedPaths: []
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: apiApplicationClientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
        }
        validation: {
          allowedAudiences: [
            apiApplicationClientId
            'api://${apiApplicationClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  tags: tags
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
    minimalTlsVersion: 'Tls12'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous7Days'
      }
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmosAccount
  name: 'EmailSignatures'
  properties: {
    resource: {
      id: 'EmailSignatures'
    }
  }
}

resource templatesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: 'Templates'
  properties: {
    resource: {
      id: 'Templates'
      partitionKey: {
        paths: [
          '/templateId'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource applicationAuditContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: 'SignatureApplicationAudit'
  properties: {
    resource: {
      id: 'SignatureApplicationAudit'
      defaultTtl: auditRetentionDays * 24 * 60 * 60
      partitionKey: {
        paths: [
          '/userObjectId'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource userPreferencesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: 'UserSignaturePreferences'
  properties: {
    resource: {
      id: 'UserSignaturePreferences'
      partitionKey: {
        paths: [
          '/userObjectId'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource signatureImagesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDatabase
  name: 'SignatureImages'
  properties: {
    resource: {
      id: 'SignatureImages'
      partitionKey: {
        paths: [
          '/id'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionAppName, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: functionApp.identity.principalId
    scope: cosmosAccount.id
  }
}

resource storageBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(blobStorage.id, functionAppName, storageBlobDataContributorRoleId)
  scope: blobStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(blobStorage.id, functionAppName, storageQueueDataContributorRoleId)
  scope: blobStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageTableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(blobStorage.id, functionAppName, storageTableDataContributorRoleId)
  scope: blobStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource privateEndpoints 'Microsoft.Network/privateEndpoints@2024-05-01' = [for endpoint in [
  {
    name: '${namingPrefix}-${suffix}-cosmos-pe'
    targetId: cosmosAccount.id
    groupId: 'Sql'
    dnsZoneIndex: 0
    connectionName: 'cosmos-sql'
  }
  {
    name: '${namingPrefix}-${suffix}-blob-pe'
    targetId: blobStorage.id
    groupId: 'blob'
    dnsZoneIndex: 1
    connectionName: 'storage-blob'
  }
  {
    name: '${namingPrefix}-${suffix}-queue-pe'
    targetId: blobStorage.id
    groupId: 'queue'
    dnsZoneIndex: 2
    connectionName: 'storage-queue'
  }
  {
    name: '${namingPrefix}-${suffix}-table-pe'
    targetId: blobStorage.id
    groupId: 'table'
    dnsZoneIndex: 3
    connectionName: 'storage-table'
  }
]: {
  name: endpoint.name
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: endpoint.connectionName
        properties: {
          privateLinkServiceId: endpoint.targetId
          groupIds: [
            endpoint.groupId
          ]
        }
      }
    ]
  }
}]

resource privateEndpointDnsGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (endpoint, index) in [
  {
    name: 'cosmos'
    zoneIndex: 0
  }
  {
    name: 'blob'
    zoneIndex: 1
  }
  {
    name: 'queue'
    zoneIndex: 2
  }
  {
    name: 'table'
    zoneIndex: 3
  }
]: {
  parent: privateEndpoints[index]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: endpoint.name
        properties: {
          privateDnsZoneId: privateDnsZones[endpoint.zoneIndex].id
        }
      }
    ]
  }
}]

output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output templateApiUrl string = 'https://${functionApp.properties.defaultHostName}/api'
output cosmosAccountName string = cosmosAccount.name
output imageStorageAccountName string = blobStorage.name
output imageContainerName string = assetsContainer.name
output functionManagedIdentityPrincipalId string = functionApp.identity.principalId
