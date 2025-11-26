namespace functions;

using Microsoft.Azure.Cosmos;

public class CosmosService
{
    private readonly Container _container;

    public CosmosService(CosmosClient cosmosClient)
    {
        _container = cosmosClient.GetContainer("classifier-db", "shifts");
    }

    public async Task<ShiftDocument?> GetShiftAsync(string shiftId, string date)
    {
        try
        {
            var response = await _container.ReadItemAsync<ShiftDocument>(
                shiftId,
                new PartitionKey(date)
            );
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<ShiftDocument> UpsertShiftAsync(ShiftDocument shift, string date)
    {
        var response = await _container.UpsertItemAsync(
            shift,
            new PartitionKey(date)
        );
        return response.Resource;
    }
}
