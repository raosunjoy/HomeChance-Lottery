import dash
from dash import html, dcc
import plotly.express as px
import pandas as pd
import boto3
import asyncio
import platform

FPS = 60

app = dash.Dash(__name__)

cloudwatch = boto3.client('cloudwatch', region_name='us-east-1')

def get_metrics():
    response = cloudwatch.get_metric_data(
        MetricDataQueries=[
            {
                'Id': 'm1',
                'MetricStat': {
                    'MetricName': 'CPUUtilization',
                    'Namespace': 'AWS/ECS',
                    'Stat': 'Average',
                },
                'Period': 300,
                'Unit': 'Percent'
            },
        ],
        StartTime=pd.Timestamp.now() - pd.Timedelta(minutes=15),
        EndTime=pd.Timestamp.now()
    )
    return response['MetricDataResults'][0]['Values']

df = pd.DataFrame({'Time': pd.date_range(end=pd.Timestamp.now(), periods=10, freq='1min'), 'CPU': get_metrics()})
fig = px.line(df, x='Time', y='CPU', title='ECS CPU Utilization')

app.layout = html.Div([
    html.H1('HomeChance Dashboard'),
    dcc.Graph(figure=fig),
    dcc.Interval(id='interval-component', interval=60*1000, n_intervals=0)
])

@app.callback(
    dash.dependencies.Output('graph', 'figure'),
    [dash.dependencies.Input('interval-component', 'n_intervals')]
)
def update_graph(n):
    df['CPU'] = get_metrics()
    fig = px.line(df, x='Time', y='CPU', title='ECS CPU Utilization')
    return fig

async def main():
    app.run_server(host='0.0.0.0', port=8050)

if platform.system() == "Emscripten":
    asyncio.ensure_future(main())
else:
    if __name__ == "__main__":
        asyncio.run(main())