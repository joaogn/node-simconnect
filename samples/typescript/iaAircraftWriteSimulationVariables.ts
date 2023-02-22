import {
    open,
    Protocol,
    SimConnectConstants,
    SimConnectDataType,
    SimConnectPeriod,
    RawBuffer,
    EventFlag,
    NotificationPriority,
    InitPosition,
} from '../../dist';

const enum DefinitionID {
    LIGHTS,
    INITIAL_POSITION,
}

const enum RequestID {
    GET_INITIAL_POSITION,
    CREATE_AIRCRAFT,
}

const enum EventID {
    SLEW_ON,
    SLEW_LEFT,
    SLEW_OFF,
}

type DataDefinition = {
    dataDefinitionId: DefinitionID;
    datumName: string;
    unitsName: string;
    dataType: SimConnectDataType;
};

export const InitialPositionDataDefiniton = [
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE ALTITUDE',
        unitsName: 'feet',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE LATITUDE',
        unitsName: 'degrees',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE LONGITUDE',
        unitsName: 'degrees',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE BANK DEGREES',
        unitsName: 'degrees',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE HEADING DEGREES TRUE',
        unitsName: 'degrees',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'PLANE PITCH DEGREES',
        unitsName: 'degrees',
        dataType: SimConnectDataType.FLOAT64,
    },
    {
        dataDefinitionId: DefinitionID.INITIAL_POSITION,
        datumName: 'SIM ON GROUND',
        unitsName: 'bool',
        dataType: SimConnectDataType.INT32,
    },
];

const options = { remote: { host: '192.168.5.155', port: 600 } };

open('Flick lights', Protocol.FSX_SP2, options)
    .then(async ({ recvOpen, handle }) => {
        console.log('Connected:', recvOpen);

        const generateDataDefinition = (dataDefinitionArray: DataDefinition[]) => {
            dataDefinitionArray.forEach(({ dataDefinitionId, datumName, unitsName, dataType }) => {
                handle.addToDataDefinition(dataDefinitionId, datumName, unitsName, dataType);
            });
        };

        const getInitialAircraftData = async () => {
            return await new Promise<InitPosition>(resolve => {
                generateDataDefinition(InitialPositionDataDefiniton);
                handle.requestDataOnSimObject(
                    0,
                    DefinitionID.INITIAL_POSITION,
                    SimConnectConstants.OBJECT_ID_USER,
                    SimConnectPeriod.ONCE
                );

                handle.on('simObjectData', recvSimObjectData => {
                    if (recvSimObjectData.requestID === RequestID.GET_INITIAL_POSITION) {
                        const initialData = {
                            planeAltitude: recvSimObjectData.data.readFloat64(),
                            planeLatitude: recvSimObjectData.data.readFloat64(),
                            planeLongitude: recvSimObjectData.data.readFloat64(),
                            planeBankDegrees: recvSimObjectData.data.readFloat64(),
                            planeHeadingDegreesTrue: recvSimObjectData.data.readFloat64(),
                            planePitchDegrees: recvSimObjectData.data.readFloat64(),
                            simOnGround: recvSimObjectData.data.readInt32(),
                        };

                        const initPosition = new InitPosition();

                        initPosition.airspeed = -2;
                        initPosition.altitude = initialData.planeAltitude;
                        initPosition.bank = initialData.planeBankDegrees;
                        initPosition.heading = initialData.planeHeadingDegreesTrue;
                        initPosition.latitude = initialData.planeLatitude;
                        initPosition.longitude = initialData.planeLongitude;
                        initPosition.onGround = initialData.simOnGround === 1;
                        initPosition.pitch = initialData.planePitchDegrees;

                        resolve(initPosition);
                    }
                });
            });
        };

        const slewMyAircraft = async () => {
            handle.mapClientEventToSimEvent(EventID.SLEW_ON, 'SLEW_ON');

            handle.transmitClientEvent(
                SimConnectConstants.OBJECT_ID_USER,
                EventID.SLEW_ON,
                0,
                NotificationPriority.HIGHEST,
                EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY
            );

            await new Promise(resolve => setTimeout(resolve, 1000));

            handle.mapClientEventToSimEvent(EventID.SLEW_LEFT, 'AXIS_SLEW_SIDEWAYS_SET');

            handle.transmitClientEvent(
                SimConnectConstants.OBJECT_ID_USER,
                EventID.SLEW_LEFT,
                1000,
                NotificationPriority.HIGHEST,
                EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY
            );

            await new Promise(resolve => setTimeout(resolve, 1000));

            handle.mapClientEventToSimEvent(EventID.SLEW_OFF, 'SLEW_OFF');

            handle.transmitClientEvent(
                SimConnectConstants.OBJECT_ID_USER,
                EventID.SLEW_OFF,
                0,
                1, // NotificationPriority.HIGHEST
                EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY
            );
        };

        const createNewAircraft = async (initPosition: InitPosition) => {
            return await new Promise<number>(resolve => {
                handle.aICreateNonATCAircraft(
                    'Cessna 152 Asobo',
                    '',
                    initPosition,
                    RequestID.CREATE_AIRCRAFT
                );

                handle.on('assignedObjectID', data => {
                    handle.aIReleaseControl(data.objectID, data.requestID);
                    resolve(data.objectID);
                });
            });
        };

        const initPosition = await getInitialAircraftData();
        console.log({ initPosition });

        await slewMyAircraft();

        const objectId = await createNewAircraft(initPosition);

        console.log({ objectId });

        const lights = ['LIGHT LANDING', 'LIGHT LOGO', 'LIGHT TAXI', 'LIGHT WING', 'LIGHT NAV'];

        lights.forEach(lightName => {
            handle.addToDataDefinition(
                DefinitionID.LIGHTS,
                lightName,
                'Bool',
                SimConnectDataType.INT32
            );
        });

        let lightsOn = false;
        const dataToSet = new RawBuffer(100);

        // Toggle all lights on/off every second
        setInterval(() => {
            lightsOn = !lightsOn;

            dataToSet.clear();
            lights.forEach(() => {
                dataToSet.writeInt32(lightsOn ? 1 : 0);
            });

            handle.setDataOnSimObject(DefinitionID.LIGHTS, SimConnectConstants.OBJECT_ID_USER, {
                buffer: dataToSet,
                arrayCount: 0,
                tagged: false,
            });
            /*
            handle.setDataOnSimObject(DefinitionID.LIGHTS, objectId, {
                buffer: dataToSet,
                arrayCount: 0,
                tagged: false,
            });
*/
        }, 1000);

        handle.on('exception', recvException => {
            console.log(recvException);
        });
    })
    .catch(error => {
        console.log('Failed to connect', error);
    });
