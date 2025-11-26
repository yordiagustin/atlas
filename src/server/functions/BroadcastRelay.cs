namespace functions;

using System.Text;
using System.Text.Json;
using Atlas.Domain;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

public class BroadcastRelay
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<BroadcastRelay> _logger;

    public BroadcastRelay(HttpClient httpClient, IConfiguration configuration, ILogger<BroadcastRelay> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task BroadcastAsync(string date, string shiftKey, ShiftLog? log)
    {
        var url = _configuration["BroadcastUrl"];
        var apiKey = _configuration["BroadcastKey"];

        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogWarning("Broadcast not configured: BroadcastUrl or BroadcastKey is missing");
            return;
        }

        var notification = new
        {
            date,
            shiftKey,
            log
        };

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(notification), Encoding.UTF8, "application/json")
        };
        request.Headers.Add("X-Api-Key", apiKey);

        try
        {
            _logger.LogInformation("Sending broadcast to API: {Url}, Date: {Date}, ShiftKey: {ShiftKey}, LogEventType: {EventType}",
                url, date, shiftKey, log?.EventType ?? "null");

            var response = await _httpClient.SendAsync(request);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Broadcast successful: StatusCode={StatusCode}, Date={Date}, ShiftKey={ShiftKey}, LogEventType={EventType}",
                    (int)response.StatusCode, date, shiftKey, log?.EventType ?? "null");
            }
            else
            {
                var responseBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Broadcast failed: StatusCode={StatusCode}, ReasonPhrase={ReasonPhrase}, Response={Response}, Date={Date}, ShiftKey={ShiftKey}",
                    (int)response.StatusCode, response.ReasonPhrase, responseBody, date, shiftKey);
            }
            
            response.EnsureSuccessStatusCode();
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error broadcasting to API: {Url}, Date={Date}, ShiftKey={ShiftKey}, Message={Message}",
                url, date, shiftKey, ex.Message);
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogError(ex, "Timeout broadcasting to API: {Url}, Date={Date}, ShiftKey={ShiftKey}",
                url, date, shiftKey);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error broadcasting to API: {Url}, Date={Date}, ShiftKey={ShiftKey}",
                url, date, shiftKey);
        }
    }
}

